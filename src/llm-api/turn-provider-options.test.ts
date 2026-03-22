import { describe, expect, test } from "bun:test";

import { buildTurnProviderOptions } from "./turn-provider-options.ts";

describe("buildTurnProviderOptions", () => {
  test("sets responseModalities for google models", () => {
    const result = buildTurnProviderOptions({
      modelString: "google/gemini-2.5-flash",
      thinkingEffort: undefined,
    });
    expect(result.providerOptions).toEqual({
      google: { responseModalities: ["TEXT", "IMAGE"] },
    });
  });

  test("merges responseModalities with thinking config for google models", () => {
    const result = buildTurnProviderOptions({
      modelString: "google/gemini-2.5-flash",
      thinkingEffort: "high",
    });
    expect(result.providerOptions).toMatchObject({
      google: {
        responseModalities: ["TEXT", "IMAGE"],
        thinkingConfig: expect.any(Object),
      },
    });
  });

  test("does not set responseModalities for non-google models", () => {
    const result = buildTurnProviderOptions({
      modelString: "anthropic/claude-sonnet-4-5",
      thinkingEffort: undefined,
    });
    expect(result.providerOptions).toEqual({});
  });

  test("sets responseModalities for zen google models", () => {
    const result = buildTurnProviderOptions({
      modelString: "zen/gemini-3.1-pro",
      thinkingEffort: undefined,
    });
    expect(result.providerOptions).toEqual({
      google: { responseModalities: ["TEXT", "IMAGE"] },
    });
  });
});
