import { describe, expect, test } from "bun:test";

import {
  getCacheFamily,
  getThinkingProviderOptions,
} from "./provider-options.ts";

describe("getThinkingProviderOptions", () => {
  test("requests OpenAI reasoning summary for GPT reasoning models", () => {
    expect(
      getThinkingProviderOptions("openai/gpt-5.3-codex", "medium"),
    ).toEqual({
      openai: { reasoningEffort: "medium", reasoningSummary: "auto" },
    });
    expect(getThinkingProviderOptions("zen/gpt-5.3-codex", "high")).toEqual({
      openai: { reasoningEffort: "high", reasoningSummary: "auto" },
    });
  });

  test("returns Gemini 2.5 thinking options even when tools are enabled", () => {
    expect(
      getThinkingProviderOptions("google/gemini-2.5-pro", "medium"),
    ).toEqual({
      google: {
        thinkingConfig: {
          includeThoughts: true,
          thinkingBudget: 8_192,
        },
      },
    });
  });

  test("returns Gemini 3 thinking options for zen models even when tools are enabled", () => {
    expect(getThinkingProviderOptions("zen/gemini-3.1-pro", "xhigh")).toEqual({
      google: {
        thinkingConfig: {
          includeThoughts: true,
          thinkingLevel: "high",
        },
      },
    });
  });
});

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
