import type { FlexibleSchema, StepResult } from "ai";
import {
	dynamicTool,
	jsonSchema,
	pruneMessages,
	stepCountIs,
	streamText,
} from "ai";
import { isApiLogEnabled, logApiEvent } from "./api-log.ts";
import {
	getReasoningDeltaFromStreamChunk,
	isOpenAIGPT,
	normalizeOpenAICompatibleToolCallInputs,
	sanitizeGeminiToolMessages,
	sanitizeGeminiToolMessagesWithMetadata,
	stripGPTCommentaryFromHistory,
	stripOpenAIHistoryTransforms,
	stripOpenAIItemIdsFromHistory,
} from "./history-transforms.ts";
import {
	getCacheFamily,
	getCachingProviderOptions,
	getThinkingProviderOptions,
	type ThinkingEffort,
} from "./providers.ts";
import type { ToolDef, TurnEvent } from "./types.ts";

type StreamTextOptions = Parameters<typeof streamText>[0];
export type CoreMessage = NonNullable<StreamTextOptions["messages"]>[number];
type CoreModel = StreamTextOptions["model"];
type ToolSet = NonNullable<StreamTextOptions["tools"]>;
type ToolEntry = ToolSet extends Record<string, infer T> ? T : never;
type StreamChunk = { type?: string; [key: string]: unknown };

export type ContextPruningMode = "off" | "balanced" | "aggressive";

interface ToolContributorStats {
	toolName: string;
	count: number;
	bytes: number;
}

interface RoleStats {
	count: number;
	bytes: number;
}

interface MessageDiagnostics {
	messageCount: number;
	totalBytes: number;
	roleBreakdown: Record<string, RoleStats>;
	toolResults: {
		count: number;
		bytes: number;
		topContributors: ToolContributorStats[];
	};
}

const DEFAULT_TOOL_RESULT_PAYLOAD_CAP_BYTES = 16 * 1024;

function getByteLength(value: string): number {
	return Buffer.byteLength(value, "utf8");
}

function safeStringify(value: unknown): string {
	try {
		return JSON.stringify(value) ?? "null";
	} catch {
		return JSON.stringify(String(value));
	}
}

/**
 * Lightweight alternative to getMessageDiagnostics that computes only the
 * fields needed for the context-pruned yield event (no roleBreakdown / tool
 * contributor maps). Used when the API log is disabled.
 */
function getMessageStats(messages: CoreMessage[]): {
	messageCount: number;
	totalBytes: number;
} {
	let totalBytes = 0;
	for (const m of messages) totalBytes += getByteLength(safeStringify(m));
	return { messageCount: messages.length, totalBytes };
}

export function getMessageDiagnostics(
	messages: CoreMessage[],
): MessageDiagnostics {
	const roleBreakdown: Record<string, RoleStats> = {};
	const toolContributorMap = new Map<
		string,
		{ count: number; bytes: number }
	>();
	let totalBytes = 0;
	let toolResultBytes = 0;
	let toolResultCount = 0;

	for (const message of messages) {
		const serializedMessage = safeStringify(message);
		const messageBytes = getByteLength(serializedMessage);
		totalBytes += messageBytes;

		const role = message.role;
		const roleStats = roleBreakdown[role] ?? { count: 0, bytes: 0 };
		roleStats.count += 1;
		roleStats.bytes += messageBytes;
		roleBreakdown[role] = roleStats;

		if (!Array.isArray(message.content)) continue;
		for (const part of message.content) {
			if (!isRecord(part)) continue;
			const partType = (part as { type?: unknown }).type;
			if (partType !== "tool-result") continue;
			toolResultCount += 1;

			const partRecord = part as Record<string, unknown>;
			const rawToolName = partRecord.toolName;
			const toolName =
				typeof rawToolName === "string" && rawToolName.length > 0
					? rawToolName
					: "unknown";
			const payload =
				"output" in partRecord
					? partRecord.output
					: "result" in partRecord
						? partRecord.result
						: null;
			const payloadBytes = getByteLength(safeStringify(payload));
			toolResultBytes += payloadBytes;

			const existing = toolContributorMap.get(toolName) ?? {
				count: 0,
				bytes: 0,
			};
			existing.count += 1;
			existing.bytes += payloadBytes;
			toolContributorMap.set(toolName, existing);
		}
	}

	const topContributors = [...toolContributorMap.entries()]
		.map(([toolName, stats]) => ({
			toolName,
			count: stats.count,
			bytes: stats.bytes,
		}))
		.sort((a, b) =>
			b.bytes === a.bytes
				? a.toolName.localeCompare(b.toolName)
				: b.bytes - a.bytes,
		)
		.slice(0, 5);

	return {
		messageCount: messages.length,
		totalBytes,
		roleBreakdown,
		toolResults: {
			count: toolResultCount,
			bytes: toolResultBytes,
			topContributors,
		},
	};
}

export function applyContextPruning(
	messages: CoreMessage[],
	mode: ContextPruningMode,
): CoreMessage[] {
	if (mode === "off") return messages;
	if (mode === "aggressive") {
		return pruneMessages({
			messages,
			reasoning: "before-last-message",
			toolCalls: "before-last-20-messages",
			emptyMessages: "remove",
		}) as CoreMessage[];
	}

	return pruneMessages({
		messages,
		reasoning: "before-last-message",
		toolCalls: "before-last-40-messages",
		emptyMessages: "remove",
	}) as CoreMessage[];
}

function compactHeadTail(
	serialized: string,
	maxChars = 4096,
): { head: string; tail: string } {
	const chars = Math.max(512, maxChars);
	const headLength = Math.floor(chars / 2);
	const tailLength = chars - headLength;
	return {
		head: serialized.slice(0, headLength),
		tail: serialized.slice(-tailLength),
	};
}

function wrapCompactedToolResultOutput(
	compactedPayload: Record<string, unknown>,
): unknown {
	return {
		type: "json",
		value: compactedPayload,
	};
}

export function compactToolResultPayloads(
	messages: CoreMessage[],
	capBytes = DEFAULT_TOOL_RESULT_PAYLOAD_CAP_BYTES,
): CoreMessage[] {
	if (!Number.isFinite(capBytes) || capBytes <= 0) return messages;

	let mutated = false;
	const compacted = messages.map((message) => {
		if (message.role !== "tool" || !Array.isArray(message.content)) {
			return message;
		}

		let contentMutated = false;
		const nextContent = message.content.map((part) => {
			if (!isRecord(part)) return part;
			const partType = (part as { type?: unknown }).type;
			if (partType !== "tool-result") return part;

			const payload =
				"output" in part ? part.output : "result" in part ? part.result : null;
			const serializedPayload = safeStringify(payload);
			const originalBytes = getByteLength(serializedPayload);
			if (originalBytes <= capBytes) return part;

			const { head, tail } = compactHeadTail(
				serializedPayload,
				Math.floor(capBytes / 2),
			);
			const compactedPayload = {
				truncated: true,
				originalBytes,
				strategy: "head-tail",
				head,
				tail,
			};

			contentMutated = true;
			const partRecord = part as Record<string, unknown>;
			if ("output" in partRecord) {
				return {
					...partRecord,
					output: wrapCompactedToolResultOutput(compactedPayload),
				};
			}
			if ("result" in partRecord) {
				return { ...partRecord, result: compactedPayload };
			}
			return {
				...partRecord,
				output: wrapCompactedToolResultOutput(compactedPayload),
			};
		});

		if (!contentMutated) return message;
		mutated = true;
		return {
			...message,
			content: nextContent as CoreMessage["content"],
		} as CoreMessage;
	});

	return mutated ? compacted : messages;
}

type StreamTextResult = ReturnType<typeof streamText>;
type StreamTextResultFull = StreamTextResult & {
	fullStream: AsyncIterable<StreamChunk>;
	response: Promise<{ messages?: CoreMessage[] }>;
};

const MAX_STEPS = 50;
// ─── Helpers ──────────────────────────────────────────────────────────────────

function isZodSchema(s: unknown): boolean {
	// Zod schemas have a _def property; plain JSON Schema objects don't.
	return s !== null && typeof s === "object" && "_def" in (s as object);
}

function toCoreTool(def: ToolDef): ReturnType<typeof dynamicTool> {
	// MCP tools pass raw JSON Schema objects; the AI SDK requires them to be
	// wrapped with jsonSchema(). Zod schemas are passed through as-is.
	const schema = isZodSchema(def.schema)
		? (def.schema as FlexibleSchema<unknown>)
		: jsonSchema(def.schema);
	return dynamicTool({
		description: def.description,
		inputSchema: schema,
		execute: async (input: unknown) => {
			try {
				return await def.execute(input);
			} catch (err) {
				throw err instanceof Error ? err : new Error(String(err));
			}
		},
	});
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object";
}

export {
	getReasoningDeltaFromStreamChunk,
	isOpenAIGPT,
	normalizeOpenAICompatibleToolCallInputs,
	sanitizeGeminiToolMessages,
	stripGPTCommentaryFromHistory,
	stripOpenAIItemIdsFromHistory,
};

export function annotateAnthropicCacheBreakpoints(
	turnMessages: CoreMessage[],
	systemPrompt?: string,
): {
	messages: CoreMessage[];
	systemPrompt?: string;
	diagnostics: { breakpointsAdded: number; stableIdx: number };
} {
	const finalMessages = [...turnMessages];
	let breakpointsAdded = 0;

	// Breakpoint 2: The last user message or 2nd to last message,
	// to cache the conversation history minus the very last turn.
	const stableIdx = finalMessages.length > 2 ? finalMessages.length - 2 : -1;
	if (stableIdx >= 0 && finalMessages[stableIdx]) {
		const msg = finalMessages[stableIdx];
		finalMessages[stableIdx] = {
			...msg,
			providerOptions: {
				...(msg?.providerOptions ?? {}),
				anthropic: {
					...((msg?.providerOptions?.anthropic as Record<string, unknown>) ??
						{}),
					cacheControl: { type: "ephemeral" },
				},
			},
		} as CoreMessage;
		breakpointsAdded++;
	}

	// Breakpoint 1: the system prompt
	let finalSystemPrompt = systemPrompt;
	if (systemPrompt) {
		finalMessages.unshift({
			role: "system",
			content: systemPrompt,
			providerOptions: {
				anthropic: { cacheControl: { type: "ephemeral" } },
			},
		});
		finalSystemPrompt = undefined; // Do not send as top-level system
		breakpointsAdded++;
	}

	return {
		messages: finalMessages,
		...(finalSystemPrompt !== undefined
			? { systemPrompt: finalSystemPrompt }
			: {}),
		diagnostics: { breakpointsAdded, stableIdx },
	};
}

/**
 * Run a single agent turn against the model.
 *
 * Yields TurnEvents as they arrive, then yields a final TurnCompleteEvent
 * (or TurnErrorEvent on failure).
 */
// helper for deep merge
const mergeDeep = (
	target: Record<string, unknown>,
	source: Record<string, unknown>,
) => {
	const output: Record<string, unknown> = { ...target };
	for (const key in source) {
		const sVal = source[key];
		const tVal = target[key];
		if (isRecord(sVal) && isRecord(tVal)) {
			output[key] = { ...tVal, ...sVal };
		} else {
			output[key] = sVal;
		}
	}
	return output;
};

export async function* runTurn(options: {
	model: CoreModel;
	modelString: string;
	messages: CoreMessage[];
	tools: ToolDef[];
	systemPrompt?: string;
	signal?: AbortSignal;
	thinkingEffort?: ThinkingEffort;
	pruningMode?: ContextPruningMode;
	toolResultPayloadCapBytes?: number;
	promptCachingEnabled?: boolean;
	openaiPromptCacheRetention?: "in_memory" | "24h";
	googleCachedContent?: string | null;
}): AsyncGenerator<TurnEvent> {
	const {
		model,
		modelString,
		messages,
		tools,
		systemPrompt,
		signal,
		thinkingEffort,
		pruningMode = "balanced",
		promptCachingEnabled = true,
		openaiPromptCacheRetention = "in_memory",
		googleCachedContent = null,
		toolResultPayloadCapBytes = DEFAULT_TOOL_RESULT_PAYLOAD_CAP_BYTES,
	} = options;

	let stepCount = 0;
	const toolSet = {} as ToolSet;
	for (const def of tools) {
		(toolSet as Record<string, ToolEntry>)[def.name] = toCoreTool(def);
	}

	let inputTokens = 0;
	let outputTokens = 0;
	// Overwritten each step — after all steps this holds the last step's input
	// token count, which approximates context window usage (each step re-sends
	// the full conversation history, so later steps have larger prompts).
	let contextTokens = 0;

	const partialState = { messages: [] as CoreMessage[] };

	try {
		// OpenAI GPT models use the Responses API (@ai-sdk/openai v3 / ai v6 default),
		// but we keep prompts only in `system` messages for consistency across
		// providers and to avoid prompting shape drift on GPT reasoning models.

		const toolCount = Object.keys(toolSet).length;
		const thinkingOpts = thinkingEffort
			? getThinkingProviderOptions(modelString, thinkingEffort)
			: null;
		const reasoningSummaryRequested =
			isRecord(thinkingOpts) &&
			isRecord(thinkingOpts.openai) &&
			typeof thinkingOpts.openai.reasoningSummary === "string";
		logApiEvent("turn start", {
			modelString,
			messageCount: messages.length,
			reasoningSummaryRequested,
			pruningMode,
			toolResultPayloadCapBytes,
		});

		const geminiSanitizationResult = sanitizeGeminiToolMessagesWithMetadata(
			messages,
			modelString,
			toolCount > 0,
		);
		const geminiSanitizedMessages = geminiSanitizationResult.messages;
		if (geminiSanitizationResult.repaired) {
			logApiEvent("gemini tool history repaired", {
				modelString,
				reason: geminiSanitizationResult.reason,
				repairedFromIndex: geminiSanitizationResult.repairedFromIndex,
				droppedMessageCount: geminiSanitizationResult.droppedMessageCount,
				tailOnlyAffected: geminiSanitizationResult.tailOnlyAffected,
			});
		}

		// Single-pass merged transform (commentary + item-ID strip) instead of
		// two sequential full-array passes; individual functions kept for tests.
		const openAIStrippedMessages = stripOpenAIHistoryTransforms(
			geminiSanitizedMessages,
			modelString,
		);
		if (
			openAIStrippedMessages !== geminiSanitizedMessages &&
			isApiLogEnabled()
		) {
			logApiEvent("openai history transforms applied", { modelString });
		}

		const compatNormalizedMessages = normalizeOpenAICompatibleToolCallInputs(
			openAIStrippedMessages,
			modelString,
		);
		if (
			compatNormalizedMessages !== openAIStrippedMessages &&
			isApiLogEnabled()
		) {
			logApiEvent("openai-compatible tool input normalized", { modelString });
		}

		// Only compute full diagnostics when the API log is active; otherwise
		// use a lightweight count+bytes helper that skips roleBreakdown/topContributors.
		const apiLogOn = isApiLogEnabled();
		const prePruneDiagnostics = apiLogOn
			? getMessageDiagnostics(compatNormalizedMessages)
			: getMessageStats(compatNormalizedMessages);
		if (apiLogOn) logApiEvent("turn context pre-prune", prePruneDiagnostics);
		const prunedMessages = applyContextPruning(
			compatNormalizedMessages,
			pruningMode,
		);
		const postPruneDiagnostics = apiLogOn
			? getMessageDiagnostics(prunedMessages)
			: getMessageStats(prunedMessages);
		if (apiLogOn) logApiEvent("turn context post-prune", postPruneDiagnostics);
		if (
			(pruningMode === "balanced" || pruningMode === "aggressive") &&
			(postPruneDiagnostics.messageCount < prePruneDiagnostics.messageCount ||
				postPruneDiagnostics.totalBytes < prePruneDiagnostics.totalBytes)
		) {
			yield {
				type: "context-pruned",
				mode: pruningMode,
				beforeMessageCount: prePruneDiagnostics.messageCount,
				afterMessageCount: postPruneDiagnostics.messageCount,
				removedMessageCount:
					prePruneDiagnostics.messageCount - postPruneDiagnostics.messageCount,
				beforeTotalBytes: prePruneDiagnostics.totalBytes,
				afterTotalBytes: postPruneDiagnostics.totalBytes,
				removedBytes:
					prePruneDiagnostics.totalBytes - postPruneDiagnostics.totalBytes,
			};
		}

		const turnMessages = compactToolResultPayloads(
			prunedMessages,
			toolResultPayloadCapBytes,
		);
		if (turnMessages !== prunedMessages && apiLogOn) {
			logApiEvent("turn context post-compaction", {
				capBytes: toolResultPayloadCapBytes,
				diagnostics: getMessageDiagnostics(turnMessages),
			});
		}
		const cacheFamily = getCacheFamily(modelString);
		const googleExplicitCachingCompatible = toolCount === 0 && !systemPrompt;
		const cacheOpts = getCachingProviderOptions(modelString, {
			enabled: promptCachingEnabled,
			openaiRetention: openaiPromptCacheRetention,
			googleCachedContent,
			googleExplicitCachingCompatible,
		});
		logApiEvent("prompt caching configured", {
			enabled: promptCachingEnabled,
			cacheFamily,
			cacheOpts,
			googleExplicitCachingCompatible,
		});
		let mergedProviderOptions = {
			...(thinkingOpts ?? {}),
			...(isOpenAIGPT(modelString)
				? {
						openai: {
							store: false,
							...(isRecord(thinkingOpts?.openai)
								? (thinkingOpts.openai as object)
								: {}),
						},
					}
				: {}),
		};

		if (cacheOpts) {
			mergedProviderOptions = mergeDeep(mergedProviderOptions, cacheOpts);
		}

		let finalMessages = turnMessages;
		let finalSystemPrompt = systemPrompt;

		if (cacheFamily === "anthropic" && promptCachingEnabled) {
			const annotated = annotateAnthropicCacheBreakpoints(
				turnMessages,
				systemPrompt,
			);
			finalMessages = annotated.messages;
			finalSystemPrompt = annotated.systemPrompt;
			logApiEvent("Anthropic prompt caching", annotated.diagnostics);
		}

		const streamOpts: StreamTextOptions = {
			model,
			messages: finalMessages,
			tools: toolSet,
			stopWhen: stepCountIs(MAX_STEPS),
			onStepFinish: (step: StepResult<ToolSet>) => {
				logApiEvent("step finish", {
					stepNumber: stepCount + 1,
					finishReason: step.finishReason,
					usage: step.usage,
				});
				inputTokens += step.usage?.inputTokens ?? 0;
				outputTokens += step.usage?.outputTokens ?? 0;
				contextTokens = step.usage?.inputTokens ?? contextTokens;
				stepCount++;

				// Accumulate messages from each step finish.
				// AI SDK's step.response.messages (or step.messages in newer versions)
				// contains the authoritative, deduplicated list of all messages
				// generated across all steps.
				const s = step as unknown as {
					response?: { messages?: CoreMessage[] };
					messages?: CoreMessage[];
				};
				partialState.messages =
					s.response?.messages ?? s.messages ?? partialState.messages;
			},
			// On the last allowed step, strip all tools so the model is forced to
			// respond with text — no more tool calls are possible.
			prepareStep: ({ stepNumber }: { stepNumber: number }) => {
				if (stepNumber >= MAX_STEPS - 1) {
					return { activeTools: [] as Array<keyof typeof toolSet> };
				}
				return undefined;
			},

			...(finalSystemPrompt ? { system: finalSystemPrompt } : {}),
			...(Object.keys(mergedProviderOptions).length > 0
				? { providerOptions: mergedProviderOptions }
				: {}),
			...(signal ? { abortSignal: signal } : {}),
			// Guard against proxy idle-timeout killing long-running streams (e.g. when
			// a model spends >60 s generating a large tool-call argument before the
			// first chunk arrives). 120 s gives plenty of headroom for slow models
			// while still surfacing a clean error instead of a silent ECONNRESET.
			timeout: { chunkMs: 120_000 },
		};

		const result = streamText(streamOpts) as StreamTextResultFull;
		// If the stream is aborted, result.response will reject with an AbortError.
		// If the for-await loop breaks early or throws, result.response is never
		// awaited, causing an unhandled rejection that crashes the app.
		// We catch it here to mark it as handled (awaiting it later will still throw).
		result.response.catch(() => {});
		// Stream events
		for await (const chunk of result.fullStream) {
			const c = chunk as StreamChunk;

			if (
				c.type !== "text-delta" &&
				c.type !== "reasoning" &&
				c.type !== "reasoning-delta"
			) {
				logApiEvent("stream chunk", {
					type: c.type,
					toolCallId: c.toolCallId,
					toolName: c.toolName,
					isError: c.isError,
					// Truncate args/output to avoid massive logs if desired, but for now log it all to debug hangups
					hasArgs: "args" in c || "input" in c,
					hasOutput: "output" in c || "result" in c,
				});
			}

			switch (c.type) {
				case "text-delta": {
					// AI SDK v6: property is `text`.
					const delta = typeof c.text === "string" ? c.text : "";
					yield {
						type: "text-delta",
						delta,
					};
					break;
				}
				case "reasoning-delta":
				case "reasoning": {
					const delta = getReasoningDeltaFromStreamChunk(c);
					if (delta === null) break;
					yield {
						type: "reasoning-delta",
						delta,
					};
					break;
				}

				case "tool-input-start": {
					yield {
						type: "tool-input-start",
						toolCallId: String(c.toolCallId ?? ""),
						toolName: String(c.toolName ?? ""),
						args: c.input ?? c.args,
					};
					break;
				}

				case "tool-call": {
					const toolName = String(c.toolName ?? "");
					const toolCallId = String(c.toolCallId ?? "");
					yield {
						type: "tool-call-start",
						toolCallId,
						toolName,
						// AI SDK v6: property is `input`, not `args`
						args: c.input ?? c.args,
					};
					break;
				}

				case "tool-result": {
					yield {
						type: "tool-result",
						toolCallId: String(c.toolCallId ?? ""),
						toolName: String(c.toolName ?? ""),
						// AI SDK v6: property is `output`, not `result`
						result:
							"output" in c ? c.output : "result" in c ? c.result : undefined,
						isError: "isError" in c ? Boolean(c.isError) : false,
					};
					break;
				}

				case "tool-error":
					yield {
						type: "tool-result",
						toolCallId: String(c.toolCallId ?? ""),
						toolName: String(c.toolName ?? ""),
						result: c.error ?? "Tool execution failed",
						isError: true,
					};
					break;

				case "error": {
					const err = c.error;
					throw err instanceof Error ? err : new Error(String(err));
				}
			}
		}

		// We use finalMessages accumulated from onStepFinish instead of awaiting result.response.
		// Awaiting result.response causes the process to hang indefinitely for Anthropic models in Bun
		// due to a known bug in @ai-sdk/anthropic's tee() stream usage.
		// Since step.response.messages includes the full deduplicated list, the last invocation
		// gives us the exact equivalent without waiting on the broken promise.
		const newMessages = partialState.messages;

		logApiEvent("turn complete", {
			newMessagesCount: newMessages.length,
			inputTokens,
			outputTokens,
		});

		yield {
			type: "turn-complete",
			inputTokens,
			outputTokens,
			contextTokens,
			// Pass raw ModelMessage objects — no conversion; they are fed back to
			// streamText on the next turn and must stay in their original shape.
			messages: newMessages,
		};
	} catch (err) {
		logApiEvent("turn error", err);
		yield {
			type: "turn-error",
			error: err instanceof Error ? err : new Error(String(err)),
			partialMessages: partialState.messages,
		};
	}
}
