import type { streamText } from "ai";

import { logApiEvent } from "../logging/context.ts";
import { getMaxOutputTokens } from "./model-info.ts";
import { isAnthropicModelFamily } from "./model-routing.ts";
import type { ThinkingEffort } from "./provider-options.ts";
import {
  annotateAnthropicCacheBreakpoints,
  applyStepPruning,
  compactToolResultPayloads,
  getMessageStats,
} from "./turn-context.ts";
import { prepareTurnMessages } from "./turn-prepare-messages.ts";
import { buildTurnProviderOptions } from "./turn-provider-options.ts";

export interface StepPruneRecord {
  removedMessageCount: number;
  removedBytes: number;
  beforeMessageCount: number;
  afterMessageCount: number;
  beforeTotalBytes: number;
  afterTotalBytes: number;
}

type StreamTextOptions = Parameters<typeof streamText>[0];
type CoreMessage = NonNullable<StreamTextOptions["messages"]>[number];
type CoreModel = StreamTextOptions["model"];
type ToolSet = NonNullable<StreamTextOptions["tools"]>;

const continueUntilModelStops: NonNullable<
  StreamTextOptions["stopWhen"]
> = () => false;

interface BuildTurnPreparationInput {
  modelString: string;
  messages: CoreMessage[];
  thinkingEffort: ThinkingEffort | undefined;
  toolCount: number;
  systemPrompt: string | undefined;
}

export function buildTurnPreparation(input: BuildTurnPreparationInput): {
  providerOptionsResult: ReturnType<typeof buildTurnProviderOptions>;
  prepared: ReturnType<typeof prepareTurnMessages>;
} {
  const providerOptionsResult = buildTurnProviderOptions({
    modelString: input.modelString,
    thinkingEffort: input.thinkingEffort,
  });

  const prepared = prepareTurnMessages({
    messages: input.messages,
    modelString: input.modelString,
    toolCount: input.toolCount,
    systemPrompt: input.systemPrompt,
  });

  return { providerOptionsResult, prepared };
}

interface BuildStreamTextRequestInput {
  model: CoreModel;
  modelString: string;
  prepared: ReturnType<typeof prepareTurnMessages>;
  toolSet: ToolSet;
  onStepFinish: NonNullable<StreamTextOptions["onStepFinish"]>;
  signal: AbortSignal | undefined;
  providerOptions: Record<string, unknown>;
  stepPruneQueue: StepPruneRecord[];
}

export function buildStreamTextRequest(
  input: BuildStreamTextRequestInput,
): StreamTextOptions {
  // Per-step context management via prepareStep: prunes old tool history,
  // compacts large payloads, and annotates Anthropic cache breakpoints.
  // Runs on CoreMessages before SDK conversion, so pruneMessages operates
  // on the correct types and message boundaries.
  const isAnthropic = isAnthropicModelFamily(input.modelString);
  const initialMessageCount = input.prepared.messages.length;

  return {
    model: input.model,
    maxOutputTokens: getMaxOutputTokens(input.modelString) ?? 16384,
    messages: input.prepared.messages,
    tools: input.toolSet,
    stopWhen: continueUntilModelStops,
    onStepFinish: input.onStepFinish,
    prepareStep: ({ stepNumber, messages }) => {
      // Step 0: already pruned by prepareTurnMessages, only annotate
      // cache breakpoints.
      if (stepNumber === 0) {
        return isAnthropic
          ? {
              messages: annotateAnthropicCacheBreakpoints(
                messages as CoreMessage[],
              ) as typeof messages,
            }
          : {};
      }
      // Steps 1+: use step-aware pruning that preserves the cached
      // prefix and keeps the model's chain-of-thought.
      const preCount = messages.length;
      const pruned = applyStepPruning(
        messages as CoreMessage[],
        initialMessageCount,
      );
      const postCount = pruned.length;
      if (postCount < preCount) {
        const pre = getMessageStats(messages as CoreMessage[]);
        const post = getMessageStats(pruned);
        input.stepPruneQueue.push({
          beforeMessageCount: pre.messageCount,
          afterMessageCount: post.messageCount,
          removedMessageCount: pre.messageCount - post.messageCount,
          beforeTotalBytes: pre.totalBytes,
          afterTotalBytes: post.totalBytes,
          removedBytes: pre.totalBytes - post.totalBytes,
        });
      }
      const compacted = compactToolResultPayloads(pruned);
      const final = isAnthropic
        ? annotateAnthropicCacheBreakpoints(compacted)
        : compacted;
      return { messages: final as typeof messages };
    },
    ...(input.prepared.systemPrompt
      ? { system: input.prepared.systemPrompt }
      : {}),
    ...(Object.keys(input.providerOptions).length > 0
      ? {
          providerOptions:
            input.providerOptions as unknown as StreamTextOptions["providerOptions"],
        }
      : {}),
    ...(input.signal ? { abortSignal: input.signal } : {}),
    onError: ({ error }) => {
      // The AI SDK logs errors to stderr by default. We surface failures through
      // streamed turn events so CLI output stays compact and consistent.
      // Log the error so we can debug silent stream terminations.
      logApiEvent("streamText onError", { error: String(error) });
    },
  } as StreamTextOptions;
}
