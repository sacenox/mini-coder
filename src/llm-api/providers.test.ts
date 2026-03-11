import { describe, expect, test } from "bun:test";

import { shouldDisableGeminiThinkingForTools } from "./providers.ts";

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
