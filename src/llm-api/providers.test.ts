import { describe, expect, test } from "bun:test";

import { getThinkingProviderOptions } from "./providers.ts";

describe("getThinkingProviderOptions", () => {
	test("requests OpenAI reasoning summary for GPT reasoning models", () => {
		expect(
			getThinkingProviderOptions("openai/gpt-5.3-codex", "medium", false),
		).toEqual({
			openai: { reasoningEffort: "medium", reasoningSummary: "auto" },
		});
		expect(
			getThinkingProviderOptions("zen/gpt-5.3-codex", "high", false),
		).toEqual({
			openai: { reasoningEffort: "high", reasoningSummary: "auto" },
		});
	});

	test("returns Gemini 2.5 thinking options even when tools are enabled", () => {
		expect(
			getThinkingProviderOptions("google/gemini-2.5-pro", "medium", true),
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
		expect(
			getThinkingProviderOptions("zen/gemini-3.1-pro", "xhigh", true),
		).toEqual({
			google: {
				thinkingConfig: {
					includeThoughts: true,
					thinkingLevel: "high",
				},
			},
		});
	});
});

import { getCacheFamily, getCachingProviderOptions } from "./providers.ts";

describe("getCacheFamily", () => {
	test("identifies anthropic family", () => {
		expect(getCacheFamily("anthropic/claude-3-opus")).toBe("anthropic");
		expect(getCacheFamily("zen/claude-sonnet-4-6")).toBe("anthropic");
	});
	test("identifies openai family", () => {
		expect(getCacheFamily("openai/gpt-4")).toBe("openai");
		expect(getCacheFamily("zen/gpt-4o")).toBe("openai");
		expect(getCacheFamily("zen/o1")).toBe("openai");
	});
	test("identifies google family", () => {
		expect(getCacheFamily("google/gemini-2.0-flash")).toBe("google");
		expect(getCacheFamily("zen/gemini-2.5-pro")).toBe("google");
	});
	test("identifies none for others", () => {
		expect(getCacheFamily("ollama/llama3")).toBe("none");
	});
});

describe("getCachingProviderOptions", () => {
	test("returns null if disabled", () => {
		expect(
			getCachingProviderOptions("openai/gpt-4", { enabled: false }),
		).toBeNull();
	});

	test("returns openai prompt cache retention", () => {
		expect(
			getCachingProviderOptions("openai/gpt-4", {
				enabled: true,
				openaiRetention: "24h",
			}),
		).toEqual({
			openai: { promptCacheRetention: "24h" },
		});
	});

	test("returns google cached content when explicit caching is compatible", () => {
		expect(
			getCachingProviderOptions("google/gemini-1.5-pro", {
				enabled: true,
				googleCachedContent: "cache-123",
				googleExplicitCachingCompatible: true,
			}),
		).toEqual({
			google: { cachedContent: "cache-123" },
		});
	});

	test("returns null for google when explicit caching is incompatible", () => {
		expect(
			getCachingProviderOptions("google/gemini-1.5-pro", {
				enabled: true,
				googleCachedContent: "cache-123",
				googleExplicitCachingCompatible: false,
			}),
		).toBeNull();
	});

	test("returns null for google if no content id", () => {
		expect(
			getCachingProviderOptions("google/gemini-1.5-pro", {
				enabled: true,
				googleCachedContent: null,
			}),
		).toBeNull();
	});

	test("returns null for anthropic (handled via messages)", () => {
		expect(
			getCachingProviderOptions("anthropic/claude-3-opus", {
				enabled: true,
			}),
		).toBeNull();
	});
});
