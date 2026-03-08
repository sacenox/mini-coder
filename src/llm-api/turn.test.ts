import { describe, expect, test } from "bun:test";
import type { CoreMessage } from "./turn.ts";
import {
	createToolLimitWarningPatch,
	isOpenAIGPT,
	restoreToolLimitWarningResult,
	stripToolLimitWarningMessages,
} from "./turn.ts";

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

describe("tool limit warning patches", () => {
	test("restores warning-patched streamed tool results to their original values", () => {
		const jsonPatch = createToolLimitWarningPatch({ path: "foo.ts" });
		const textPatch = createToolLimitWarningPatch("exit 0");

		expect(
			restoreToolLimitWarningResult(jsonPatch.injectedText, [
				jsonPatch,
				textPatch,
			]),
		).toEqual({ path: "foo.ts" });
		expect(
			restoreToolLimitWarningResult(textPatch.injectedText, [
				jsonPatch,
				textPatch,
			]),
		).toBe("exit 0");
		expect(restoreToolLimitWarningResult("plain output", [jsonPatch])).toBe(
			"plain output",
		);
	});

	test("restores original text and json tool outputs for persisted messages", () => {
		const jsonPatch = createToolLimitWarningPatch({ lines: 2 });
		const textPatch = createToolLimitWarningPatch("exit 0");
		const toolMessage = {
			role: "tool",
			content: [
				{
					type: "tool-result",
					toolCallId: "1",
					toolName: "read",
					output: { type: "text", value: jsonPatch.injectedText },
				},
			],
		} as CoreMessage;
		const assistantMessage = {
			role: "assistant",
			content: [
				{ type: "text", text: "One last response." },
				{
					type: "tool-result",
					toolCallId: "2",
					toolName: "shell",
					output: { type: "text", value: textPatch.injectedText },
				},
			],
		} as CoreMessage;
		const untouched: CoreMessage = { role: "assistant", content: "All done." };

		const cleaned = stripToolLimitWarningMessages(
			[toolMessage, assistantMessage, untouched],
			[jsonPatch, textPatch],
		);

		expect(cleaned).toEqual([
			{
				role: "tool",
				content: [
					{
						type: "tool-result",
						toolCallId: "1",
						toolName: "read",
						output: { type: "json", value: { lines: 2 } },
					},
				],
			},
			{
				role: "assistant",
				content: [
					{ type: "text", text: "One last response." },
					{
						type: "tool-result",
						toolCallId: "2",
						toolName: "shell",
						output: { type: "text", value: "exit 0" },
					},
				],
			},
			untouched,
		]);
		expect(cleaned[0]).not.toBe(toolMessage);
		expect(cleaned[1]).not.toBe(assistantMessage);
		expect(cleaned[2]).toBe(untouched);
	});

	test("returns the original array when there are no warning patches", () => {
		const messages: CoreMessage[] = [{ role: "assistant", content: "hello" }];
		expect(stripToolLimitWarningMessages(messages, [])).toBe(messages);
	});
});
