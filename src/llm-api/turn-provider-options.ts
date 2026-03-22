import { isRecord } from "./history/shared.ts";
import { isOpenAIGPT } from "./history-transforms.ts";
import { isGeminiModelFamily } from "./model-routing.ts";
import {
  getCacheFamily,
  getThinkingProviderOptions,
  type ThinkingEffort,
} from "./provider-options.ts";

interface BuildTurnProviderOptionsInput {
  modelString: string;
  thinkingEffort: ThinkingEffort | undefined;
}

interface TurnProviderOptionsResult {
  cacheFamily: ReturnType<typeof getCacheFamily>;
  thinkingOpts: Record<string, unknown> | null;
  providerOptions: Record<string, unknown>;
  reasoningSummaryRequested: boolean;
}

export function buildTurnProviderOptions(
  input: BuildTurnProviderOptionsInput,
): TurnProviderOptionsResult {
  const { modelString, thinkingEffort } = input;

  const thinkingOpts = thinkingEffort
    ? getThinkingProviderOptions(modelString, thinkingEffort)
    : null;

  const reasoningSummaryRequested =
    isRecord(thinkingOpts) &&
    isRecord(thinkingOpts.openai) &&
    typeof thinkingOpts.openai.reasoningSummary === "string";

  const cacheFamily = getCacheFamily(modelString);

  const googleOpts = isGeminiModelFamily(modelString)
    ? {
        google: {
          responseModalities: ["TEXT", "IMAGE"],
          ...(isRecord(thinkingOpts?.google)
            ? (thinkingOpts.google as object)
            : {}),
        },
      }
    : {};

  const providerOptions = {
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
    ...googleOpts,
  };

  return {
    cacheFamily,
    thinkingOpts,
    providerOptions,
    reasoningSummaryRequested,
  };
}
