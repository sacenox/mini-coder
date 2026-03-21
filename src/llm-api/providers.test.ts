import { describe, expect, test } from "bun:test";

import { getCacheFamily } from "./provider-options.ts";

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
