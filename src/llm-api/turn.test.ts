import { describe, expect, test } from "bun:test";
import type { CoreMessage } from "./turn.ts";
import {
	getReasoningDeltaFromStreamChunk,
	isOpenAIGPT,
	sanitizeGeminiToolMessages,
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

describe("getReasoningDeltaFromStreamChunk", () => {
	test("reads SDK reasoning-delta text field", () => {
		expect(
			getReasoningDeltaFromStreamChunk({
				type: "reasoning-delta",
				text: "step by step",
			}),
		).toBe("step by step");
	});

	test("keeps compatibility with legacy reasoning textDelta field", () => {
		expect(
			getReasoningDeltaFromStreamChunk({
				type: "reasoning",
				textDelta: "legacy reasoning",
			}),
		).toBe("legacy reasoning");
	});

	test("returns null for non-reasoning chunks", () => {
		expect(
			getReasoningDeltaFromStreamChunk({ type: "text-delta", text: "hi" }),
		).toBe(null);
	});
});

describe("sanitizeGeminiToolMessages", () => {
	test("truncates the current Gemini tool turn when any tool call lacks a thought signature", () => {
		const messages = [
			{ role: "user", content: "older turn" },
			{
				role: "assistant",
				content: [
					{
						type: "tool-call",
						toolCallId: "old-call",
						toolName: "read",
						input: {},
						providerOptions: { google: { thoughtSignature: "sig-old" } },
					},
				],
			},
			{
				role: "tool",
				content: [] as unknown as CoreMessage["content"],
			},
			{ role: "user", content: "current turn" },
			{
				role: "assistant",
				content: [
					{
						type: "tool-call",
						toolCallId: "ok-call",
						toolName: "read",
						input: {},
						providerOptions: { google: { thoughtSignature: "sig-ok" } },
					},
					{
						type: "tool-call",
						toolCallId: "broken-call",
						toolName: "replace",
						input: {},
					},
				],
			},
			{
				role: "tool",
				content: [
					{
						type: "tool-result",
						toolCallId: "ok-call",
						toolName: "read",
						output: { type: "json", value: { ok: true } },
					},
					{
						type: "tool-result",
						toolCallId: "broken-call",
						toolName: "replace",
						output: { type: "json", value: { ok: true } },
					},
				],
			},
		] as unknown as CoreMessage[];

		const sanitized = sanitizeGeminiToolMessages(
			messages,
			"zen/gemini-3.1-pro",
			true,
		);

		expect(sanitized).toEqual(messages.slice(0, 4));
	});

	test("drops earlier broken Gemini tool turns and keeps the latest user turn", () => {
		const messages = [
			{ role: "user", content: "broken turn" },
			{
				role: "assistant",
				content: [
					{
						type: "tool-call",
						toolCallId: "signed-call",
						toolName: "read",
						input: {},
						providerOptions: { google: { thoughtSignature: "sig-1" } },
					},
					{
						type: "tool-call",
						toolCallId: "unsigned-call",
						toolName: "replace",
						input: {},
					},
				],
			},
			{
				role: "tool",
				content: [] as unknown as CoreMessage["content"],
			},
			{ role: "assistant", content: "done" },
			{ role: "user", content: "latest turn" },
			{
				role: "assistant",
				content: [
					{
						type: "tool-call",
						toolCallId: "latest-call",
						toolName: "read",
						input: {},
						providerOptions: { google: { thoughtSignature: "sig-2" } },
					},
				],
			},
		] as unknown as CoreMessage[];

		expect(
			sanitizeGeminiToolMessages(messages, "google/gemini-2.5-pro", true),
		).toEqual(messages.slice(4));
	});

	test("copies legacy providerMetadata into providerOptions for Gemini tool calls", () => {
		const messages = [
			{ role: "user", content: "current turn" },
			{
				role: "assistant",
				content: [
					{
						type: "tool-call",
						toolCallId: "call-1",
						toolName: "read",
						input: {},
						providerMetadata: { google: { thoughtSignature: "sig-1" } },
					},
				],
			},
		] as unknown as CoreMessage[];

		const sanitized = sanitizeGeminiToolMessages(
			messages,
			"google/gemini-2.5-pro",
			true,
		);

		const assistant = sanitized[1] as {
			role: "assistant";
			content: Array<Record<string, unknown>>;
		};
		expect(assistant.content[0]?.providerOptions).toEqual({
			google: { thoughtSignature: "sig-1" },
		});
	});

	test("leaves non-Gemini models untouched", () => {
		const messages: CoreMessage[] = [
			{ role: "user", content: "go" },
			{
				role: "assistant",
				content: [
					{
						type: "tool-call",
						toolCallId: "call-1",
						toolName: "read",
						input: {},
					},
				],
			},
		];

		expect(sanitizeGeminiToolMessages(messages, "openai/gpt-4o", true)).toEqual(
			messages,
		);
	});
});
