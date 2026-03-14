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
	getCacheFamily,
	getCachingProviderOptions,
	getThinkingProviderOptions,
	parseModelString,
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

export function getReasoningDeltaFromStreamChunk(
	chunk: StreamChunk,
): string | null {
	if (chunk.type !== "reasoning-delta" && chunk.type !== "reasoning") {
		return null;
	}
	if (typeof chunk.text === "string") return chunk.text;
	if (typeof chunk.textDelta === "string") return chunk.textDelta;
	if (typeof chunk.delta === "string") return chunk.delta;
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

function stripOpenAIItemIdFromPart(part: unknown): {
	part: unknown;
	changed: boolean;
} {
	if (!isRecord(part)) return { part, changed: false };

	let changed = false;
	const nextPart = { ...part };

	const dropItemId = (field: "providerOptions" | "providerMetadata"): void => {
		const source = nextPart[field];
		if (!isRecord(source)) return;
		const openai = source.openai;
		if (!isRecord(openai) || !("itemId" in openai)) return;

		const nextOpenAI = { ...openai };
		delete nextOpenAI.itemId;
		nextPart[field] = { ...source, openai: nextOpenAI };
		changed = true;
	};

	dropItemId("providerOptions");
	dropItemId("providerMetadata");

	return { part: changed ? nextPart : part, changed };
}

export function stripOpenAIItemIdsFromHistory(
	messages: CoreMessage[],
	modelString: string,
): CoreMessage[] {
	if (!isOpenAIGPT(modelString)) return messages;

	let mutated = false;
	const result = messages.map((message) => {
		if (!Array.isArray(message.content)) return message;

		let contentMutated = false;
		const content = message.content.map((part) => {
			const cleaned = stripOpenAIItemIdFromPart(part);
			if (cleaned.changed) contentMutated = true;
			return cleaned.part;
		});

		if (!contentMutated) return message;
		mutated = true;
		return {
			...message,
			content: content as CoreMessage["content"],
		} as CoreMessage;
	});

	return mutated ? result : messages;
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

function isGeminiModelFamily(modelString: string): boolean {
	const { provider, modelId } = parseModelString(modelString);
	return (
		(provider === "google" || provider === "zen") &&
		modelId.startsWith("gemini-")
	);
}

type GeminiToolHistoryRepairReason = "missing-signature-anchor";

function validateGeminiAssistantToolCallMessage(message: CoreMessage): {
	valid: boolean;
	reason: GeminiToolHistoryRepairReason | null;
} {
	if (message.role !== "assistant" || !Array.isArray(message.content)) {
		return { valid: true, reason: null };
	}

	let firstToolCallPartSeen = false;
	for (const part of message.content) {
		if (!isToolCallPart(part)) continue;
		if (firstToolCallPartSeen) continue;
		firstToolCallPartSeen = true;
		if (getGeminiThoughtSignature(part) === null) {
			return { valid: false, reason: "missing-signature-anchor" };
		}
	}

	return { valid: true, reason: null };
}

function sanitizeGeminiToolMessagesWithMetadata(
	messages: CoreMessage[],
	modelString: string,
	hasTools: boolean,
): {
	messages: CoreMessage[];
	repaired: boolean;
	reason: GeminiToolHistoryRepairReason | null;
	repairedFromIndex: number;
	droppedMessageCount: number;
	tailOnlyAffected: boolean;
} {
	if (!hasTools || !isGeminiModelFamily(modelString)) {
		return {
			messages,
			repaired: false,
			reason: null,
			repairedFromIndex: -1,
			droppedMessageCount: 0,
			tailOnlyAffected: true,
		};
	}

	const normalized = messages.map((message) =>
		normalizeMessageProviderOptions(message),
	);

	for (let index = normalized.length - 1; index >= 0; index -= 1) {
		const message = normalized[index];
		if (!message) continue;
		if (message.role !== "assistant" || !Array.isArray(message.content))
			continue;
		if (!message.content.some((part) => isToolCallPart(part))) continue;

		const validation = validateGeminiAssistantToolCallMessage(message);
		if (validation.valid) {
			return {
				messages: normalized,
				repaired: false,
				reason: null,
				repairedFromIndex: -1,
				droppedMessageCount: 0,
				tailOnlyAffected: true,
			};
		}

		const nextUserIndex = normalized.findIndex(
			(candidate, candidateIndex) =>
				candidateIndex > index && candidate?.role === "user",
		);
		if (nextUserIndex === -1) {
			return {
				messages: normalized.slice(0, index),
				repaired: true,
				reason: validation.reason,
				repairedFromIndex: index,
				droppedMessageCount: normalized.length - index,
				tailOnlyAffected: true,
			};
		}

		return {
			messages: [
				...normalized.slice(0, index),
				...normalized.slice(nextUserIndex),
			],
			repaired: true,
			reason: validation.reason,
			repairedFromIndex: index,
			droppedMessageCount: nextUserIndex - index,
			tailOnlyAffected: false,
		};
	}

	return {
		messages: normalized,
		repaired: false,
		reason: null,
		repairedFromIndex: -1,
		droppedMessageCount: 0,
		tailOnlyAffected: true,
	};
}

export function sanitizeGeminiToolMessages(
	messages: CoreMessage[],
	modelString: string,
	hasTools: boolean,
): CoreMessage[] {
	return sanitizeGeminiToolMessagesWithMetadata(messages, modelString, hasTools)
		.messages;
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
 * Merged single-pass replacement for the sequential
 * `stripGPTCommentaryFromHistory` + `stripOpenAIItemIdsFromHistory` calls in
 * `runTurn`. Both transforms are OpenAI-only; combining them into one loop
 * halves the number of full-array allocations on OpenAI sessions.
 *
 * The individual exported functions are kept for direct use / tests.
 */
function stripOpenAIHistoryTransforms(
	messages: CoreMessage[],
	modelString: string,
): CoreMessage[] {
	if (!isOpenAIGPT(modelString)) return messages;

	let mutated = false;
	const result: CoreMessage[] = [];
	let skipToolResults = false;

	for (const message of messages) {
		// Commentary: skip orphaned tool-result messages following a fully-dropped
		// assistant message.
		if (skipToolResults) {
			if (message.role === "tool") {
				mutated = true;
				continue;
			}
			skipToolResults = false;
		}

		// Item-ID strip: filter providerOptions.openai.itemId from all content parts.
		let contentMutated = false;
		const strippedContent = Array.isArray(message.content)
			? message.content.map((part) => {
					const cleaned = stripOpenAIItemIdFromPart(part);
					if (cleaned.changed) contentMutated = true;
					return cleaned.part;
				})
			: message.content;

		const msgAfterIdStrip: CoreMessage = contentMutated
			? ({
					...message,
					content: strippedContent as CoreMessage["content"],
				} as CoreMessage)
			: message;

		if (contentMutated) mutated = true;

		// Commentary strip: filter phase:"commentary" text parts from assistant messages.
		if (
			message.role === "assistant" &&
			Array.isArray(msgAfterIdStrip.content)
		) {
			const filtered = msgAfterIdStrip.content.filter(
				(part) => !isCommentaryTextPart(part),
			);
			if (filtered.length === msgAfterIdStrip.content.length) {
				result.push(msgAfterIdStrip);
			} else if (filtered.length === 0) {
				// Entire message was commentary: drop it and any following tool results.
				mutated = true;
				skipToolResults = true;
			} else {
				mutated = true;
				result.push({
					...msgAfterIdStrip,
					content: filtered,
				} as CoreMessage);
			}
		} else {
			result.push(msgAfterIdStrip);
		}
	}

	return mutated ? result : messages;
}

/**
 * Returns true when the model string refers to an OpenAI GPT model routed
 * through the OpenAI SDK stack (direct OpenAI or Zen OpenAI).
 */
export function isOpenAIGPT(modelString: string): boolean {
	const { provider, modelId } = parseModelString(modelString);
	return (
		(provider === "openai" || provider === "zen") && modelId.startsWith("gpt-")
	);
}

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

		// Only compute full diagnostics when the API log is active; otherwise
		// use a lightweight count+bytes helper that skips roleBreakdown/topContributors.
		const apiLogOn = isApiLogEnabled();
		const prePruneDiagnostics = apiLogOn
			? getMessageDiagnostics(openAIStrippedMessages)
			: getMessageStats(openAIStrippedMessages);
		if (apiLogOn) logApiEvent("turn context pre-prune", prePruneDiagnostics);
		const prunedMessages = applyContextPruning(
			openAIStrippedMessages,
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
