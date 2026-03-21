import { supportsThinking } from "./model-info.ts";
import {
  isAnthropicModelFamily,
  isGeminiModelFamily,
  isOpenAIReasoningModelFamily,
  parseModelString,
} from "./model-routing.ts";

export type ThinkingEffort = "low" | "medium" | "high" | "xhigh";

// Budget tokens for models that only support `thinking: { type: "enabled" }`
// (Zen proxy, and Haiku which lacks adaptive thinking support).
const ANTHROPIC_BUDGET: Record<ThinkingEffort, number> = {
  low: 4_096,
  medium: 8_192,
  high: 16_384,
  xhigh: 32_768,
};

// Haiku does not support adaptive thinking (only type: "enabled" with budget).
const ANTHROPIC_NO_ADAPTIVE = /^claude-haiku-/;

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
  // Zen only supports legacy `thinking: { type: "enabled", budget_tokens }`.
  // Haiku doesn't support adaptive thinking either — same fallback.
  if (provider === "zen" || ANTHROPIC_NO_ADAPTIVE.test(modelId)) {
    return {
      anthropic: {
        thinking: {
          type: "enabled",
          budgetTokens: ANTHROPIC_BUDGET[effort],
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
