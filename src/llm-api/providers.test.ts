import { describe, expect, test } from "bun:test";

import {
  getCacheFamily,
  getThinkingProviderOptions,
} from "./provider-options.ts";

describe("getCacheFamily", () => {
  test("identifies anthropic family", () => {
    expect(getCacheFamily("anthropic/claude-3-opus")).toBe("anthropic");
    expect(getCacheFamily("zen/claude-sonnet-4-6")).toBe("anthropic");
  });
  test("openai and zen/gpt-* return none (caching is automatic, no client hint needed)", () => {
    expect(getCacheFamily("openai/gpt-4")).toBe("none");
    expect(getCacheFamily("zen/gpt-4o")).toBe("none");
    expect(getCacheFamily("zen/o1")).toBe("none");
    expect(getCacheFamily("zen/gpt-5-nano")).toBe("none");
  });

  test("identifies google family", () => {
    expect(getCacheFamily("google/gemini-2.0-flash")).toBe("google");
    expect(getCacheFamily("zen/gemini-2.5-pro")).toBe("google");
  });
  test("identifies none for others", () => {
    expect(getCacheFamily("ollama/llama3")).toBe("none");
  });
});

describe("getThinkingProviderOptions", () => {
  // zen/claude-haiku-4-5 has reasoning=1 in the real DB (seeded from models.dev)
  // and must use the legacy `thinking: { type: "enabled", budget_tokens: N }` API
  // because the Zen proxy does not support the `effort-2025-11-24` beta.
  test("zen claude uses enabled+budgetTokens, not adaptive+effort", () => {
    const opts = getThinkingProviderOptions("zen/claude-haiku-4-5", "medium");
    if (!opts) {
      // Model not in local DB yet — skip rather than fail in fresh envs
      return;
    }
    const anthropic = (opts as Record<string, unknown>).anthropic as Record<
      string,
      unknown
    >;
    expect(anthropic).toBeDefined();
    const thinking = anthropic.thinking as Record<string, unknown>;
    expect(thinking.type).toBe("enabled");
    expect(typeof thinking.budgetTokens).toBe("number");
    // Must NOT have the effort field (which triggers the effort-2025-11-24 beta)
    expect(anthropic.effort).toBeUndefined();
  });

  test("direct anthropic haiku uses enabled+budgetTokens (no adaptive support)", () => {
    const opts = getThinkingProviderOptions(
      "anthropic/claude-haiku-4-5",
      "medium",
    );
    if (!opts) return;
    const anthropic = (opts as Record<string, unknown>).anthropic as Record<
      string,
      unknown
    >;
    expect(anthropic).toBeDefined();
    const thinking = anthropic.thinking as Record<string, unknown>;
    expect(thinking.type).toBe("enabled");
    expect(typeof thinking.budgetTokens).toBe("number");
    expect(anthropic.effort).toBeUndefined();
  });

  test("direct anthropic sonnet uses adaptive+effort", () => {
    const opts = getThinkingProviderOptions(
      "anthropic/claude-sonnet-4-6",
      "medium",
    );
    if (!opts) return;
    const anthropic = (opts as Record<string, unknown>).anthropic as Record<
      string,
      unknown
    >;
    expect(anthropic).toBeDefined();
    const thinking = anthropic.thinking as Record<string, unknown>;
    expect(thinking.type).toBe("adaptive");
    expect(anthropic.effort).toBe("medium");
  });
});
