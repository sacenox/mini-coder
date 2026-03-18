import { streamText } from "ai";
import { isApiLogEnabled, logApiEvent } from "./api-log.ts";
import { normalizeUnknownError } from "./error-utils.ts";
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
import {
	buildStreamTextRequest,
	buildTurnPreparation,
} from "./turn-request.ts";

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
		const { providerOptionsResult, prepared } = buildTurnPreparation({
			modelString,
			messages,
			thinkingEffort,
			promptCachingEnabled,
			openaiPromptCacheRetention,
			googleCachedContent,
			toolCount,
			systemPrompt,
			pruningMode,
			toolResultPayloadCapBytes,
		});

		logApiEvent("turn start", {
			modelString,
			messageCount: messages.length,
			reasoningSummaryRequested:
				providerOptionsResult.reasoningSummaryRequested,
			pruningMode,
			toolResultPayloadCapBytes,
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

		const result = streamText(
			buildStreamTextRequest({
				model,
				prepared,
				toolSet,
				onStepFinish: stepTracker.onStepFinish,
				signal,
				providerOptions: providerOptionsResult.providerOptions,
				maxSteps: MAX_STEPS,
			}),
		) as StreamTextResultFull;
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

		const hitMaxSteps = finalState.stepCount >= MAX_STEPS;

		yield {
			type: "turn-complete",
			inputTokens: finalState.inputTokens,
			outputTokens: finalState.outputTokens,
			contextTokens: finalState.contextTokens,
			hitMaxSteps,
			messages: finalState.partialMessages,
		};
	} catch (err) {
		const finalState = stepTracker.getState();
		const normalizedError = normalizeUnknownError(err);
		logApiEvent("turn error", normalizedError);
		yield {
			type: "turn-error",
			error: normalizedError,
			partialMessages: finalState.partialMessages,
		};
	}
}
