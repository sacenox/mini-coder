import { describe, expect, test } from "bun:test";

import {
	getThinkingProviderOptions,
	shouldDisableGeminiThinkingForTools,
} from "./providers.ts";

describe("shouldDisableGeminiThinkingForTools", () => {
	test("enables workaround for affected Gemini versions", () => {
		expect(shouldDisableGeminiThinkingForTools("zen/gemini-3.1-pro")).toBe(
			true,
		);
		expect(shouldDisableGeminiThinkingForTools("google/gemini-2.5-pro")).toBe(
			true,
		);
		expect(
			shouldDisableGeminiThinkingForTools("google/gemini-2.5-flash-preview"),
		).toBe(true);
	});

	test("does not enable workaround for non-affected providers", () => {
		expect(
			shouldDisableGeminiThinkingForTools("anthropic/claude-4-sonnet"),
		).toBe(false);
		expect(shouldDisableGeminiThinkingForTools("openai/gpt-4o")).toBe(false);
	});

	test("does not enable workaround for unrelated Gemini models", () => {
		expect(shouldDisableGeminiThinkingForTools("google/gemini-1.5-pro")).toBe(
			false,
		);
		expect(shouldDisableGeminiThinkingForTools("zen/some-other-model")).toBe(
			false,
		);
	});
});

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
});
