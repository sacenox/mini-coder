import type { streamText } from "ai";

import { isAnthropicModelFamily } from "./model-routing.ts";
import type { ThinkingEffort } from "./provider-options.ts";
import {
  annotateAnthropicCacheBreakpoints,
  applyContextPruning,
  compactToolResultPayloads,
} from "./turn-context.ts";
import { prepareTurnMessages } from "./turn-prepare-messages.ts";
import { buildTurnProviderOptions } from "./turn-provider-options.ts";

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
}

export function buildStreamTextRequest(
  input: BuildStreamTextRequestInput,
): StreamTextOptions {
  // Per-step context management via prepareStep: prunes old tool history,
  // compacts large payloads, and annotates Anthropic cache breakpoints.
  // Runs on CoreMessages before SDK conversion, so pruneMessages operates
  // on the correct types and message boundaries.
  const isAnthropic = isAnthropicModelFamily(input.modelString);

  return {
    model: input.model,
    maxOutputTokens: 16384,
    messages: input.prepared.messages,
    tools: input.toolSet,
    stopWhen: continueUntilModelStops,
    onStepFinish: input.onStepFinish,
    prepareStep: ({ stepNumber, messages }) => {
      // Step 0 messages are already pruned by prepareTurnMessages;
      // only apply cache breakpoints.
      if (stepNumber === 0) {
        return isAnthropic
          ? {
              messages: annotateAnthropicCacheBreakpoints(
                messages as CoreMessage[],
              ) as typeof messages,
            }
          : {};
      }
      const pruned = applyContextPruning(messages as CoreMessage[]);
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
    onError: () => {
      // The AI SDK logs errors to stderr by default. We surface failures through
      // streamed turn events so CLI output stays compact and consistent.
    },
    timeout: { chunkMs: 120_000 },
  } as StreamTextOptions;
}
