import { describe, expect, test } from "bun:test";
import { isOpenAIGPT } from "./turn.ts";

describe("isOpenAIGPT", () => {
	test("matches openai/gpt-* models", () => {
		expect(isOpenAIGPT("openai/gpt-4o")).toBe(true);
		expect(isOpenAIGPT("openai/gpt-4o-mini")).toBe(true);
		expect(isOpenAIGPT("openai/gpt-5.3-codex")).toBe(true);
	});

	test("matches zen/gpt-* models", () => {
		expect(isOpenAIGPT("zen/gpt-5.3-codex")).toBe(true);
		expect(isOpenAIGPT("zen/gpt-4o")).toBe(true);
	});

	test("does not match non-gpt openai models", () => {
		expect(isOpenAIGPT("openai/o3")).toBe(false);
		expect(isOpenAIGPT("openai/o1-mini")).toBe(false);
	});

	test("does not match other providers", () => {
		expect(isOpenAIGPT("anthropic/claude-sonnet-4-5")).toBe(false);
		expect(isOpenAIGPT("google/gemini-2.0-flash")).toBe(false);
		expect(isOpenAIGPT("zen/claude-sonnet-4-6")).toBe(false);
	});
});
