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
