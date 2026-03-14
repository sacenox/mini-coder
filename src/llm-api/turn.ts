import type { FlexibleSchema, StepResult } from "ai";
import { dynamicTool, jsonSchema, stepCountIs, streamText } from "ai";
import { isApiLogEnabled, logApiEvent } from "./api-log.ts";
import {
	normalizeOpenAICompatibleToolCallInputs,
	sanitizeGeminiToolMessagesWithMetadata,
	stripOpenAIHistoryTransforms,
} from "./history-transforms.ts";
import { getCacheFamily, type ThinkingEffort } from "./provider-options.ts";
import {
	annotateAnthropicCacheBreakpoints,
	applyContextPruning,
	type ContextPruningMode,
	compactToolResultPayloads,
	DEFAULT_TOOL_RESULT_PAYLOAD_CAP_BYTES,
	getMessageDiagnostics,
	getMessageStats,
} from "./turn-context.ts";
import { buildTurnProviderOptions } from "./turn-provider-options.ts";

export type { ContextPruningMode } from "./turn-context.ts";

import {
	mapStreamChunkToTurnEvent,
	shouldLogStreamChunk,
} from "./turn-stream-events.ts";
import type { ToolDef, TurnEvent } from "./types.ts";

type StreamTextOptions = Parameters<typeof streamText>[0];
export type CoreMessage = NonNullable<StreamTextOptions["messages"]>[number];
type CoreModel = StreamTextOptions["model"];
type ToolSet = NonNullable<StreamTextOptions["tools"]>;
type ToolEntry = ToolSet extends Record<string, infer T> ? T : never;

type StreamTextResultFull = ReturnType<typeof streamText> & {
	fullStream: AsyncIterable<{ type?: string; [key: string]: unknown }>;
	response: Promise<{ messages?: CoreMessage[] }>;
};

const MAX_STEPS = 50;

// ─── Local helpers ────────────────────────────────────────────────────────────

function isZodSchema(s: unknown): boolean {
	return s !== null && typeof s === "object" && "_def" in (s as object);
}

function toCoreTool(def: ToolDef): ReturnType<typeof dynamicTool> {
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

// ─── Message preparation pipeline ────────────────────────────────────────────

interface PreparedMessages {
	messages: CoreMessage[];
	systemPrompt: string | undefined;
	/** True if context pruning removed any messages. */
	pruned: boolean;
	prePruneMessageCount: number;
	prePruneTotalBytes: number;
	postPruneMessageCount: number;
	postPruneTotalBytes: number;
}

/**
 * Apply provider-specific history sanitisation, context pruning, and
 * payload compaction. Returns the messages ready to send to the model.
 */
function prepareMessages(
	messages: CoreMessage[],
	modelString: string,
	toolCount: number,
	systemPrompt: string | undefined,
	pruningMode: ContextPruningMode,
	toolResultPayloadCapBytes: number,
	promptCachingEnabled: boolean,
): PreparedMessages {
	const apiLogOn = isApiLogEnabled();

	// 1. Provider-specific sanitisation
	const geminiResult = sanitizeGeminiToolMessagesWithMetadata(
		messages,
		modelString,
		toolCount > 0,
	);
	if (geminiResult.repaired && apiLogOn) {
		logApiEvent("gemini tool history repaired", {
			modelString,
			reason: geminiResult.reason,
			repairedFromIndex: geminiResult.repairedFromIndex,
			droppedMessageCount: geminiResult.droppedMessageCount,
			tailOnlyAffected: geminiResult.tailOnlyAffected,
		});
	}

	const openaiStripped = stripOpenAIHistoryTransforms(
		geminiResult.messages,
		modelString,
	);
	if (openaiStripped !== geminiResult.messages && apiLogOn) {
		logApiEvent("openai history transforms applied", { modelString });
	}

	const normalised = normalizeOpenAICompatibleToolCallInputs(
		openaiStripped,
		modelString,
	);
	if (normalised !== openaiStripped && apiLogOn) {
		logApiEvent("openai-compatible tool input normalized", { modelString });
	}

	// 2. Context pruning
	const preStats = apiLogOn
		? getMessageDiagnostics(normalised)
		: getMessageStats(normalised);
	if (apiLogOn) logApiEvent("turn context pre-prune", preStats);

	const pruned = applyContextPruning(normalised, pruningMode);

	const postStats = apiLogOn
		? getMessageDiagnostics(pruned)
		: getMessageStats(pruned);
	if (apiLogOn) logApiEvent("turn context post-prune", postStats);

	// 3. Payload compaction
	const compacted = compactToolResultPayloads(
		pruned,
		toolResultPayloadCapBytes,
	);
	if (compacted !== pruned && apiLogOn) {
		logApiEvent("turn context post-compaction", {
			capBytes: toolResultPayloadCapBytes,
			diagnostics: getMessageDiagnostics(compacted),
		});
	}

	// 4. Anthropic prompt caching breakpoints
	let finalMessages = compacted;
	let finalSystemPrompt = systemPrompt;

	const cacheFamily = getCacheFamily(modelString);
	if (cacheFamily === "anthropic" && promptCachingEnabled) {
		const annotated = annotateAnthropicCacheBreakpoints(
			compacted,
			systemPrompt,
		);
		finalMessages = annotated.messages;
		finalSystemPrompt = annotated.systemPrompt;
		if (apiLogOn)
			logApiEvent("Anthropic prompt caching", annotated.diagnostics);
	}

	const wasPruned =
		(pruningMode === "balanced" || pruningMode === "aggressive") &&
		(postStats.messageCount < preStats.messageCount ||
			postStats.totalBytes < preStats.totalBytes);

	return {
		messages: finalMessages,
		systemPrompt: finalSystemPrompt,
		pruned: wasPruned,
		prePruneMessageCount: preStats.messageCount,
		prePruneTotalBytes: preStats.totalBytes,
		postPruneMessageCount: postStats.messageCount,
		postPruneTotalBytes: postStats.totalBytes,
	};
}

// ─── runTurn ──────────────────────────────────────────────────────────────────

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
	let contextTokens = 0;
	const partialState = { messages: [] as CoreMessage[] };

	try {
		const toolCount = Object.keys(toolSet).length;
		const providerOptionsResult = buildTurnProviderOptions({
			modelString,
			thinkingEffort,
			promptCachingEnabled,
			openaiPromptCacheRetention,
			googleCachedContent,
			toolCount,
			hasSystemPrompt: Boolean(systemPrompt),
		});

		logApiEvent("turn start", {
			modelString,
			messageCount: messages.length,
			reasoningSummaryRequested:
				providerOptionsResult.reasoningSummaryRequested,
			pruningMode,
			toolResultPayloadCapBytes,
		});

		// Prepare messages: sanitize, prune, compact, annotate cache breakpoints
		const prepared = prepareMessages(
			messages,
			modelString,
			toolCount,
			systemPrompt,
			pruningMode,
			toolResultPayloadCapBytes,
			promptCachingEnabled,
		);

		if (prepared.pruned) {
			yield {
				type: "context-pruned",
				mode: pruningMode as "balanced" | "aggressive",
				beforeMessageCount: prepared.prePruneMessageCount,
				afterMessageCount: prepared.postPruneMessageCount,
				removedMessageCount:
					prepared.prePruneMessageCount - prepared.postPruneMessageCount,
				beforeTotalBytes: prepared.prePruneTotalBytes,
				afterTotalBytes: prepared.postPruneTotalBytes,
				removedBytes:
					prepared.prePruneTotalBytes - prepared.postPruneTotalBytes,
			};
		}

		if (isApiLogEnabled()) {
			logApiEvent("prompt caching configured", {
				enabled: promptCachingEnabled,
				cacheFamily: providerOptionsResult.cacheFamily,
				cacheOpts: providerOptionsResult.cacheOpts,
			});
		}

		const result = streamText({
			model,
			messages: prepared.messages,
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
				const s = step as unknown as {
					response?: { messages?: CoreMessage[] };
					messages?: CoreMessage[];
				};
				partialState.messages =
					s.response?.messages ?? s.messages ?? partialState.messages;
			},
			prepareStep: ({ stepNumber }: { stepNumber: number }) => {
				// On the last allowed step, disable tools so the model gives a final answer
				if (stepNumber >= MAX_STEPS - 1) {
					return { activeTools: [] as Array<keyof typeof toolSet> };
				}
				return undefined;
			},
			...(prepared.systemPrompt ? { system: prepared.systemPrompt } : {}),
			...(Object.keys(providerOptionsResult.providerOptions).length > 0
				? { providerOptions: providerOptionsResult.providerOptions }
				: {}),
			...(signal ? { abortSignal: signal } : {}),
			timeout: { chunkMs: 120_000 },
		} as StreamTextOptions) as StreamTextResultFull;
		result.response.catch(() => {});

		for await (const chunk of result.fullStream) {
			const streamChunk = chunk as Record<string, unknown> & { type?: string };
			if (shouldLogStreamChunk(streamChunk)) {
				logApiEvent("stream chunk", {
					type: streamChunk.type,
					toolCallId: streamChunk.toolCallId,
					toolName: streamChunk.toolName,
					isError: streamChunk.isError,
					hasArgs: "args" in streamChunk || "input" in streamChunk,
					hasOutput: "output" in streamChunk || "result" in streamChunk,
				});
			}
			const event = mapStreamChunkToTurnEvent(streamChunk);
			if (event) yield event;
		}

		logApiEvent("turn complete", {
			newMessagesCount: partialState.messages.length,
			inputTokens,
			outputTokens,
		});

		yield {
			type: "turn-complete",
			inputTokens,
			outputTokens,
			contextTokens,
			messages: partialState.messages,
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
