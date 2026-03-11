import type { FlexibleSchema, StepResult } from "ai";
import {
	dynamicTool,
	jsonSchema,
	pruneMessages,
	stepCountIs,
	streamText,
} from "ai";
import { logApiEvent } from "./api-log.ts";
import {
	getThinkingProviderOptions,
	parseModelString,
	shouldDisableGeminiThinkingForTools,
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
			toolCalls: "before-last-2-messages",
			emptyMessages: "remove",
		}) as CoreMessage[];
	}

	return pruneMessages({
		messages,
		reasoning: "before-last-message",
		toolCalls: "before-last-3-messages",
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
				return { ...partRecord, output: compactedPayload };
			}
			if ("result" in partRecord) {
				return { ...partRecord, result: compactedPayload };
			}
			return { ...partRecord, output: compactedPayload };
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

export function getReasoningDeltaFromStreamChunk(
	chunk: StreamChunk,
): string | null {
	if (chunk.type !== "reasoning-delta" && chunk.type !== "reasoning") {
		return null;
	}
	if (typeof chunk.text === "string") return chunk.text;
	if (typeof chunk.textDelta === "string") return chunk.textDelta;
	return "";
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

function normalizeProviderOptions<T>(part: T): T {
	if (!isRecord(part)) return part;
	if (
		part.providerOptions !== undefined ||
		part.providerMetadata === undefined
	) {
		return part;
	}
	return {
		...part,
		providerOptions: part.providerMetadata,
	} as T;
}

function normalizeMessageProviderOptions(message: CoreMessage): CoreMessage {
	if (!Array.isArray(message.content)) return message;
	return {
		...message,
		content: message.content.map((part) =>
			normalizeProviderOptions(part),
		) as CoreMessage["content"],
	} as CoreMessage;
}

/**
 * Reads the effective provider-options record for a content part, checking
 * both the modern `providerOptions` field and the legacy `providerMetadata`
 * alias (used by some older AI SDK versions and Gemini adapters).
 */
function getPartProviderOptions(part: unknown): Record<string, unknown> | null {
	if (!isRecord(part)) return null;
	if (isRecord(part.providerOptions)) return part.providerOptions;
	if (isRecord(part.providerMetadata)) return part.providerMetadata;
	return null;
}

function getGeminiThoughtSignature(part: unknown): string | null {
	const providerOptions = getPartProviderOptions(part);
	if (!providerOptions) return null;

	for (const provider of ["google", "vertex"] as const) {
		const metadata = providerOptions[provider];
		if (!isRecord(metadata)) continue;
		const signature = metadata.thoughtSignature;
		if (typeof signature === "string" && signature.length > 0) {
			return signature;
		}
	}

	return null;
}

function isToolCallPart(part: unknown): part is Record<string, unknown> {
	return isRecord(part) && part.type === "tool-call";
}

function assistantMessageHasUnsignedGeminiToolCall(
	message: CoreMessage,
): boolean {
	if (message.role !== "assistant" || !Array.isArray(message.content)) {
		return false;
	}

	for (const part of message.content) {
		if (!isToolCallPart(part)) continue;
		if (getGeminiThoughtSignature(part) === null) return true;
	}

	return false;
}

export function sanitizeGeminiToolMessages(
	messages: CoreMessage[],
	modelString: string,
	hasTools: boolean,
): CoreMessage[] {
	if (!hasTools || !shouldDisableGeminiThinkingForTools(modelString)) {
		return messages;
	}

	let sanitized = messages.map((message) =>
		normalizeMessageProviderOptions(message),
	);

	while (true) {
		const brokenIndex = sanitized.findIndex((message) =>
			assistantMessageHasUnsignedGeminiToolCall(message),
		);
		if (brokenIndex === -1) return sanitized;

		const nextUserIndex = sanitized.findIndex(
			(message, index) => index > brokenIndex && message.role === "user",
		);
		if (nextUserIndex !== -1) {
			sanitized = [
				...sanitized.slice(0, brokenIndex),
				...sanitized.slice(nextUserIndex),
			];
			continue;
		}

		return sanitized.slice(0, brokenIndex);
	}
}

/**
 * Returns the phase of a text content part for OpenAI Responses API models.
 * GPT-5 reasoning models emit "commentary" text parts (thinking-out-loud text
 * like `to=functions.shell json{...}`) before their actual function calls.
 * These are distinct from the "final_answer" phase which is real output.
 */
function getOpenAITextPhase(part: unknown): string | null {
	const providerOptions = getPartProviderOptions(part);
	if (!providerOptions) return null;
	const openai = providerOptions.openai;
	if (!isRecord(openai)) return null;
	return typeof openai.phase === "string" ? openai.phase : null;
}

function isCommentaryTextPart(part: unknown): boolean {
	if (!isRecord(part) || part.type !== "text") return false;
	return getOpenAITextPhase(part) === "commentary";
}

/**
 * Strip `phase:"commentary"` text parts from assistant messages for GPT
 * (Responses API) models.
 *
 * GPT-5 reasoning models produce commentary parts before tool calls — text
 * like "I'll call the shell function: to=functions.shell json{...}".  These
 * parts are useful during the current turn (the user can see the model
 * thinking) but must not leak into persistent conversation history.  When fed
 * back on subsequent turns the model pattern-matches on them and starts
 * reproducing that format as plain text instead of making real function calls,
 * resulting in garbled output with repeated `to=functions.<name> json{...}`
 * strings.
 */
export function stripGPTCommentaryFromHistory(
	messages: CoreMessage[],
	modelString: string,
): CoreMessage[] {
	if (!isOpenAIGPT(modelString)) return messages;

	let mutated = false;
	const result: CoreMessage[] = [];
	let skipToolResults = false;

	for (const message of messages) {
		// If the previous assistant message was fully dropped, skip any
		// immediately-following tool-result messages that would be orphaned.
		if (skipToolResults) {
			if (message.role === "tool") {
				mutated = true;
				continue;
			}
			skipToolResults = false;
		}

		if (message.role !== "assistant" || !Array.isArray(message.content)) {
			result.push(message);
			continue;
		}

		const filtered = message.content.filter(
			(part) => !isCommentaryTextPart(part),
		);

		if (filtered.length === message.content.length) {
			// Nothing stripped — keep as-is.
			result.push(message);
		} else if (filtered.length === 0) {
			// All parts were commentary: drop the entire message and any
			// tool-result messages that immediately follow it.
			mutated = true;
			skipToolResults = true;
		} else {
			// Some parts stripped but message still has content — keep it.
			mutated = true;
			result.push({ ...message, content: filtered } as CoreMessage);
		}
	}

	return mutated ? result : messages;
}

// ─── Main turn function ───────────────────────────────────────────────────────

/**
 * Returns true when the model string refers to an OpenAI GPT model, which uses
 * the Responses API and honours the `instructions` provider option as the
 * authoritative system prompt (rather than a system-role message in `input`).
 */
export function isOpenAIGPT(modelString: string): boolean {
	const { provider, modelId } = parseModelString(modelString);
	return (
		(provider === "openai" || provider === "zen") && modelId.startsWith("gpt-")
	);
}

/**
 * Run a single agent turn against the model.
 *
 * Yields TurnEvents as they arrive, then yields a final TurnCompleteEvent
 * (or TurnErrorEvent on failure).
 */
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
		// which honours `instructions` as the authoritative system prompt. Passing it
		// as a system-role message in `input` works but is treated as a lower-priority
		// user turn, causing the model to deprioritise the instructions.
		const useInstructions =
			systemPrompt !== undefined && isOpenAIGPT(modelString);

		const toolCount = Object.keys(toolSet).length;
		const thinkingOpts = thinkingEffort
			? getThinkingProviderOptions(modelString, thinkingEffort, toolCount > 0)
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

		const geminiSanitizedMessages = sanitizeGeminiToolMessages(
			messages,
			modelString,
			toolCount > 0,
		);
		if (geminiSanitizedMessages.length !== messages.length) {
			logApiEvent("gemini tool history truncated", {
				modelString,
				originalMessages: messages.length,
				sanitizedMessages: geminiSanitizedMessages.length,
			});
		}

		const gptSanitizedMessages = stripGPTCommentaryFromHistory(
			geminiSanitizedMessages,
			modelString,
		);
		if (gptSanitizedMessages !== geminiSanitizedMessages) {
			logApiEvent("gpt commentary stripped from history", { modelString });
		}

		logApiEvent(
			"turn context pre-prune",
			getMessageDiagnostics(gptSanitizedMessages),
		);
		const prunedMessages = applyContextPruning(
			gptSanitizedMessages,
			pruningMode,
		);
		logApiEvent(
			"turn context post-prune",
			getMessageDiagnostics(prunedMessages),
		);

		const turnMessages = compactToolResultPayloads(
			prunedMessages,
			toolResultPayloadCapBytes,
		);
		if (turnMessages !== prunedMessages) {
			logApiEvent("turn context post-compaction", {
				capBytes: toolResultPayloadCapBytes,
				diagnostics: getMessageDiagnostics(turnMessages),
			});
		}

		const mergedProviderOptions = {
			...(useInstructions
				? { openai: { instructions: systemPrompt, store: false } }
				: {}),
			...(thinkingOpts ?? {}),
			...(useInstructions && thinkingOpts?.openai
				? {
						openai: {
							instructions: systemPrompt,
							store: false,
							...(thinkingOpts.openai as object),
						},
					}
				: {}),
		};

		const streamOpts: StreamTextOptions = {
			model,
			messages: turnMessages,
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

			...(systemPrompt && !useInstructions ? { system: systemPrompt } : {}),
			...(Object.keys(mergedProviderOptions).length > 0
				? { providerOptions: mergedProviderOptions }
				: {}),
			...(signal ? { abortSignal: signal } : {}),
			experimental_repairToolCall: async ({ toolCall }) => {
				// To avoid 400 Bad Request from the API when it receives malformed JSON
				// in the assistant's tool_calls history, we repair it to a minimal valid JSON.
				// This allows the framework to parse it, fail schema validation gracefully,
				// and send a proper validation error back to the model without crashing the step loop.
				return { ...toolCall, args: "{}" };
			},
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
					// AI SDK v6: property is `text`, not `textDelta`
					const delta =
						typeof c.text === "string"
							? c.text
							: typeof c.textDelta === "string"
								? c.textDelta
								: "";
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

				case "tool-call": {
					yield {
						type: "tool-call-start",
						toolCallId: String(c.toolCallId ?? ""),
						toolName: String(c.toolName ?? ""),
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
