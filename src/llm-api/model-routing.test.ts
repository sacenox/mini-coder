import { describe, expect, test } from "bun:test";

import {
  getZenBackend,
  isAnthropicModelFamily,
  isGeminiModelFamily,
  isOpenAIGPTModelFamily,
  isOpenAIReasoningModelFamily,
  isZenOpenAICompatibleChatModel,
  parseModelString,
} from "./model-routing.ts";

describe("parseModelString", () => {
  test("splits provider/model-id", () => {
    expect(parseModelString("openai/gpt-4o")).toEqual({
      provider: "openai",
      modelId: "gpt-4o",
    });
  });

  test("returns empty model id when slash is missing", () => {
    expect(parseModelString("openai")).toEqual({
      provider: "openai",
      modelId: "",
    });
  });
});

describe("model family predicates", () => {
  test("matches anthropic family", () => {
    expect(isAnthropicModelFamily("anthropic/claude-sonnet-4-5")).toBe(true);
    expect(isAnthropicModelFamily("zen/claude-sonnet-4-6")).toBe(true);
    expect(isAnthropicModelFamily("zen/gpt-5")).toBe(false);
  });

  test("matches gemini family", () => {
    expect(isGeminiModelFamily("google/gemini-2.5-pro")).toBe(true);
    expect(isGeminiModelFamily("zen/gemini-3.1-pro")).toBe(true);
    expect(isGeminiModelFamily("openai/gpt-4o")).toBe(false);
  });

  test("matches openai gpt and reasoning families", () => {
    expect(isOpenAIGPTModelFamily("openai/gpt-4o")).toBe(true);
    expect(isOpenAIGPTModelFamily("zen/gpt-5.3-codex")).toBe(true);
    expect(isOpenAIGPTModelFamily("openai/o3")).toBe(false);

    expect(isOpenAIReasoningModelFamily("openai/o3")).toBe(true);
    expect(isOpenAIReasoningModelFamily("zen/gpt-5.3-codex")).toBe(true);
    expect(isOpenAIReasoningModelFamily("google/gemini-2.5-pro")).toBe(false);
  });

  test("detects zen openai-compatible chat fallback", () => {
    expect(isZenOpenAICompatibleChatModel("zen/glm-5")).toBe(true);
    expect(isZenOpenAICompatibleChatModel("zen/gpt-4o")).toBe(false);
    expect(isZenOpenAICompatibleChatModel("openai/gpt-4o")).toBe(false);
  });
});

describe("getZenBackend", () => {
  test("routes by model id prefix", () => {
    expect(getZenBackend("claude-sonnet-4-6")).toBe("anthropic");
    expect(getZenBackend("gpt-5.3-codex")).toBe("openai");
    expect(getZenBackend("gemini-3.1-pro")).toBe("google");
    expect(getZenBackend("glm-5")).toBe("compat");
  });
});
