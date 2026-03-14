import { stepCountIs, streamText } from "ai";
import { isApiLogEnabled, logApiEvent } from "./api-log.ts";
import type { ThinkingEffort } from "./provider-options.ts";
import {
	type ContextPruningMode,
	DEFAULT_TOOL_RESULT_PAYLOAD_CAP_BYTES,
} from "./turn-context.ts";
import {
	buildToolSet,
	createTurnStepTracker,
	mapFullStreamToTurnEvents,
	type StreamTextResultFull,
} from "./turn-execution.ts";
import { prepareTurnMessages } from "./turn-prepare-messages.ts";
import { buildTurnProviderOptions } from "./turn-provider-options.ts";

export type { ContextPruningMode } from "./turn-context.ts";

import type { ToolDef, TurnEvent } from "./types.ts";

type StreamTextOptions = Parameters<typeof streamText>[0];
export type CoreMessage = NonNullable<StreamTextOptions["messages"]>[number];
type CoreModel = StreamTextOptions["model"];

const MAX_STEPS = 50;

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

	const toolSet = buildToolSet(tools);
	const stepTracker = createTurnStepTracker({
		onStepLog: ({ stepNumber, finishReason, usage }) => {
			logApiEvent("step finish", {
				stepNumber,
				finishReason,
				usage,
			});
		},
	});

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
		const prepared = prepareTurnMessages({
			messages,
			modelString,
			toolCount,
			systemPrompt,
			pruningMode,
			toolResultPayloadCapBytes,
			promptCachingEnabled,
		});

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
			onStepFinish: stepTracker.onStepFinish,
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

		for await (const event of mapFullStreamToTurnEvents(result.fullStream, {
			onChunk: (streamChunk) => {
				logApiEvent("stream chunk", {
					type: streamChunk.type,
					toolCallId: streamChunk.toolCallId,
					toolName: streamChunk.toolName,
					isError: streamChunk.isError,
					hasArgs: "args" in streamChunk || "input" in streamChunk,
					hasOutput: "output" in streamChunk || "result" in streamChunk,
				});
			},
		})) {
			yield event;
		}

		const finalState = stepTracker.getState();
		logApiEvent("turn complete", {
			newMessagesCount: finalState.partialMessages.length,
			inputTokens: finalState.inputTokens,
			outputTokens: finalState.outputTokens,
		});

		yield {
			type: "turn-complete",
			inputTokens: finalState.inputTokens,
			outputTokens: finalState.outputTokens,
			contextTokens: finalState.contextTokens,
			messages: finalState.partialMessages,
		};
	} catch (err) {
		const finalState = stepTracker.getState();
		logApiEvent("turn error", err);
		yield {
			type: "turn-error",
			error: err instanceof Error ? err : new Error(String(err)),
			partialMessages: finalState.partialMessages,
		};
	}
}
