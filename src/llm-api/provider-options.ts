import { supportsThinking } from "./model-info.ts";
import {
  isAnthropicModelFamily,
  isGeminiModelFamily,
  isOpenAIReasoningModelFamily,
  parseModelString,
} from "./model-routing.ts";

export type ThinkingEffort = "low" | "medium" | "high" | "xhigh";

// Budget tokens used when routing through Zen (which only supports the
// legacy `thinking: { type: "enabled", budget_tokens: N }` API, not the
// newer effort-based API that requires the `effort-2025-11-24` beta).
const ANTHROPIC_ZEN_BUDGET: Record<ThinkingEffort, number> = {
  low: 4_096,
  medium: 8_192,
  high: 16_384,
  xhigh: 32_768,
};

type CacheFamily = "google" | "anthropic" | "none";

const GEMINI_BUDGET: Record<ThinkingEffort, number> = {
  low: 4_096,
  medium: 8_192,
  high: 16_384,
  xhigh: 24_575,
};

function clampEffort(
  effort: ThinkingEffort,
  max: ThinkingEffort,
): ThinkingEffort {
  const ORDER: ThinkingEffort[] = ["low", "medium", "high", "xhigh"];
  const effortIdx = ORDER.indexOf(effort);
  const maxIdx = ORDER.indexOf(max);
  return ORDER[Math.min(effortIdx, maxIdx)] as ThinkingEffort;
}

function getAnthropicThinkingOptions(
  modelString: string,
  effort: ThinkingEffort,
): Record<string, unknown> {
  const { provider, modelId } = parseModelString(modelString);
  // Zen proxies claude models but only supports the legacy
  // `thinking: { type: "enabled", budget_tokens: N }` API.
  // The newer effort-based API adds an `effort-2025-11-24` beta header and
  // sends `output_config: { effort }` which Zen rejects.
  if (provider === "zen") {
    return {
      anthropic: {
        thinking: {
          type: "enabled",
          budgetTokens: ANTHROPIC_ZEN_BUDGET[effort],
        },
      },
    };
  }
  const isOpus = /^claude-opus-4/.test(modelId);
  const xhighMapping = isOpus ? "max" : "high";
  const mapped = effort === "xhigh" ? xhighMapping : effort;
  return { anthropic: { thinking: { type: "adaptive" }, effort: mapped } };
}

function getOpenAIThinkingOptions(
  modelString: string,
  effort: ThinkingEffort,
): Record<string, unknown> {
  const { modelId } = parseModelString(modelString);
  const supportsXhigh = /^gpt-5\.[2-9]/.test(modelId) || /^o4/.test(modelId);
  const clamped = supportsXhigh ? effort : clampEffort(effort, "high");
  return { openai: { reasoningEffort: clamped, reasoningSummary: "auto" } };
}

function getGeminiThinkingOptions(
  modelString: string,
  effort: ThinkingEffort,
): Record<string, unknown> {
  const { modelId } = parseModelString(modelString);
  if (/^gemini-3/.test(modelId)) {
    return {
      google: {
        thinkingConfig: {
          includeThoughts: true,
          thinkingLevel: clampEffort(effort, "high"),
        },
      },
    };
  }

  return {
    google: {
      thinkingConfig: {
        includeThoughts: true,
        thinkingBudget: GEMINI_BUDGET[effort],
      },
    },
  };
}

interface ThinkingStrategy {
  supports: (modelString: string) => boolean;
  build: (
    modelString: string,
    effort: ThinkingEffort,
  ) => Record<string, unknown>;
}

const THINKING_STRATEGIES: readonly ThinkingStrategy[] = [
  {
    supports: isAnthropicModelFamily,
    build: getAnthropicThinkingOptions,
  },
  {
    supports: isOpenAIReasoningModelFamily,
    build: getOpenAIThinkingOptions,
  },
  {
    supports: isGeminiModelFamily,
    build: getGeminiThinkingOptions,
  },
];

export function getThinkingProviderOptions(
  modelString: string,
  effort: ThinkingEffort,
): Record<string, unknown> | null {
  if (!supportsThinking(modelString)) return null;

  for (const strategy of THINKING_STRATEGIES) {
    if (!strategy.supports(modelString)) continue;
    return strategy.build(modelString, effort);
  }

  return null;
}

const CACHE_FAMILY_RULES: ReadonlyArray<
  readonly [match: (modelString: string) => boolean, family: CacheFamily]
> = [
  [isAnthropicModelFamily, "anthropic"],
  [isGeminiModelFamily, "google"],
];

export function getCacheFamily(modelString: string): CacheFamily {
  for (const [match, family] of CACHE_FAMILY_RULES) {
    if (match(modelString)) return family;
  }
  return "none";
}
