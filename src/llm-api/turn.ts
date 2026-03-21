import { streamText } from "ai";
import { logApiEvent } from "../logging/context.ts";
import { normalizeUnknownError } from "./error-utils.ts";
import type { ThinkingEffort } from "./provider-options.ts";
import {
  annotateToolCaching,
  buildToolSet,
  createTurnStateTracker,
  mapFullStreamToTurnEvents,
  type StreamTextResultFull,
} from "./turn-execution.ts";
import {
  buildStreamTextRequest,
  buildTurnPreparation,
  type StepPruneRecord,
} from "./turn-request.ts";

import type { ToolDef, TurnEvent } from "./types.ts";

type StreamTextOptions = Parameters<typeof streamText>[0];
export type CoreMessage = NonNullable<StreamTextOptions["messages"]>[number];
type CoreModel = StreamTextOptions["model"];

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
}): AsyncGenerator<TurnEvent> {
  const {
    model,
    modelString,
    messages,
    tools,
    systemPrompt,
    signal,
    thinkingEffort,
  } = options;

  const rawToolSet = buildToolSet(tools);
  const toolSet = annotateToolCaching(rawToolSet, modelString);
  const turnState = createTurnStateTracker({
    onStepLog: ({ finishReason, usage }) => {
      logApiEvent("step finish", {
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
      toolCount,
      systemPrompt,
    });

    logApiEvent("turn start", {
      modelString,
      messageCount: messages.length,
      reasoningSummaryRequested:
        providerOptionsResult.reasoningSummaryRequested,
    });

    if (prepared.pruned) {
      yield {
        type: "context-pruned",
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

    const stepPruneQueue: StepPruneRecord[] = [];

    const result = streamText(
      buildStreamTextRequest({
        model,
        modelString,
        prepared,
        toolSet,
        onStepFinish: turnState.onStepFinish,
        signal,
        providerOptions: providerOptionsResult.providerOptions,
        stepPruneQueue,
      }),
    ) as StreamTextResultFull;
    result.response.catch(() => {});

    for await (const event of mapFullStreamToTurnEvents(result.fullStream, {
      stepPruneQueue,
      onChunk: (streamChunk) => {
        if (
          streamChunk.type === "tool-call" ||
          streamChunk.type === "tool-result"
        ) {
          logApiEvent("stream chunk", {
            type: streamChunk.type,
            toolCallId: streamChunk.toolCallId,
            toolName: streamChunk.toolName,
            isError: streamChunk.isError,
          });
        }
      },
    })) {
      yield event;
    }

    const finalState = turnState.getState();
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
    const finalState = turnState.getState();
    const normalizedError = normalizeUnknownError(err);
    logApiEvent("turn error", normalizedError);
    yield {
      type: "turn-error",
      error: normalizedError,
      partialMessages: finalState.partialMessages,
      inputTokens: finalState.inputTokens,
      outputTokens: finalState.outputTokens,
      contextTokens: finalState.contextTokens,
    };
  }
}
