import { describe, expect, test } from "bun:test";
import type { CoreMessage } from "./turn.ts";
import {
	applyContextPruning,
	compactToolResultPayloads,
	getMessageDiagnostics,
	getReasoningDeltaFromStreamChunk,
	isOpenAIGPT,
	sanitizeGeminiToolMessages,
	stripGPTCommentaryFromHistory,
	stripOpenAIItemIdsFromHistory,
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

	test("reads SDK reasoning-delta delta field", () => {
		expect(
			getReasoningDeltaFromStreamChunk({
				type: "reasoning",
				delta: "new delta",
			}),
		).toBe("new delta");
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
			{ role: "user", content: "healthy turn" },
			{ role: "assistant", content: "healthy response" },
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
		).toEqual([...messages.slice(0, 3), ...messages.slice(6)]);
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

describe("stripGPTCommentaryFromHistory", () => {
	test("strips commentary text parts from GPT assistant messages", () => {
		const messages: CoreMessage[] = [
			{ role: "user", content: "do the task" },
			{
				role: "assistant",
				content: [
					{
						type: "text",
						text: "I'll call shell: to=functions.shell json{...}",
						providerOptions: {
							openai: { itemId: "msg-1", phase: "commentary" },
						},
					},
					{
						type: "tool-call",
						toolCallId: "call-1",
						toolName: "shell",
						input: { command: "ls" },
					},
				],
			} as unknown as CoreMessage,
			{
				role: "tool",
				content: [
					{
						type: "tool-result",
						toolCallId: "call-1",
						toolName: "shell",
						output: { type: "text", value: "file.txt" },
					},
				],
			} as unknown as CoreMessage,
			{
				role: "assistant",
				content: [
					{
						type: "text",
						text: "Done!",
						providerOptions: {
							openai: { itemId: "msg-2", phase: "final_answer" },
						},
					},
				],
			} as unknown as CoreMessage,
		];

		const result = stripGPTCommentaryFromHistory(
			messages,
			"openai/gpt-5.3-codex",
		);

		// commentary part stripped from first assistant message
		const firstAssistant = result[1] as {
			role: "assistant";
			content: Array<Record<string, unknown>>;
		};
		expect(firstAssistant.content).toHaveLength(1);
		expect(firstAssistant.content[0]?.type).toBe("tool-call");

		// final_answer text preserved in second assistant message
		const secondAssistant = result[3] as {
			role: "assistant";
			content: Array<Record<string, unknown>>;
		};
		expect(secondAssistant.content).toHaveLength(1);
		expect(secondAssistant.content[0]?.type).toBe("text");
	});

	test("also strips when phase is in providerMetadata (legacy field)", () => {
		const messages: CoreMessage[] = [
			{
				role: "assistant",
				content: [
					{
						type: "text",
						text: "thinking...",
						providerMetadata: {
							openai: { itemId: "msg-x", phase: "commentary" },
						},
					},
					{ type: "text", text: "result", providerOptions: {} },
				],
			} as unknown as CoreMessage,
		];

		const result = stripGPTCommentaryFromHistory(messages, "zen/gpt-5.4");
		const assistant = result[0] as {
			role: "assistant";
			content: Array<Record<string, unknown>>;
		};
		expect(assistant.content).toHaveLength(1);
		expect(assistant.content[0]?.text).toBe("result");
	});

	test("leaves non-GPT models untouched", () => {
		const messages: CoreMessage[] = [
			{
				role: "assistant",
				content: [
					{
						type: "text",
						text: "thinking...",
						providerOptions: { openai: { phase: "commentary" } },
					},
				],
			} as unknown as CoreMessage,
		];

		expect(
			stripGPTCommentaryFromHistory(messages, "anthropic/claude-sonnet-4-5"),
		).toBe(messages);
	});

	test("returns same reference when no commentary parts are present", () => {
		const messages: CoreMessage[] = [
			{ role: "user", content: "hi" },
			{
				role: "assistant",
				content: [
					{
						type: "text",
						text: "hello",
						providerOptions: { openai: { phase: "final_answer" } },
					},
				],
			} as unknown as CoreMessage,
		];

		expect(stripGPTCommentaryFromHistory(messages, "openai/gpt-4o")).toBe(
			messages,
		);
	});

	const commentaryAssistantMessage = {
		role: "assistant",
		content: [
			{
				type: "text",
				text: "to=functions.shell json{}",
				providerOptions: { openai: { phase: "commentary" } },
			},
		],
	} as unknown as CoreMessage;

	function expectOnlyUserMessages(result: CoreMessage[]) {
		expect(result).toHaveLength(2);
		expect(result[0]).toEqual({ role: "user", content: "go" });
		expect(result[1]).toEqual({ role: "user", content: "next" });
	}

	test("drops assistant message whose entire content is commentary", () => {
		const messages: CoreMessage[] = [
			{ role: "user", content: "go" },
			commentaryAssistantMessage,
			{ role: "user", content: "next" },
		];

		const result = stripGPTCommentaryFromHistory(messages, "openai/gpt-5.4");
		expectOnlyUserMessages(result);
	});

	test("drops commentary-only assistant message and its orphaned tool-result message", () => {
		const orphanedToolResult = {
			role: "tool",
			content: [
				{
					type: "tool-result",
					toolCallId: "t1",
					toolName: "shell",
					output: { text: "result" },
				},
			],
		} as unknown as CoreMessage;

		const messages: CoreMessage[] = [
			{ role: "user", content: "go" },
			commentaryAssistantMessage,
			orphanedToolResult,
			{ role: "user", content: "next" },
		];

		const result = stripGPTCommentaryFromHistory(messages, "openai/gpt-5.4");
		expectOnlyUserMessages(result);
	});
});

describe("stripOpenAIItemIdsFromHistory", () => {
	test("removes openai itemId metadata from assistant content parts", () => {
		const messages: CoreMessage[] = [
			{ role: "user", content: "go" },
			{
				role: "assistant",
				content: [
					{
						type: "text",
						text: "thinking",
						providerOptions: {
							openai: { itemId: "msg_123", phase: "commentary" },
						},
					},
					{
						type: "tool-call",
						toolCallId: "call_1",
						toolName: "read",
						input: { path: "README.md" },
						providerMetadata: {
							openai: { itemId: "fc_456" },
						},
					},
				],
			} as unknown as CoreMessage,
		];

		const result = stripOpenAIItemIdsFromHistory(messages, "zen/gpt-5.3-codex");
		const assistant = result[1] as {
			role: "assistant";
			content: Array<Record<string, unknown>>;
		};
		expect(
			(
				assistant.content[0]?.providerOptions as {
					openai?: { itemId?: string; phase?: string };
				}
			)?.openai?.itemId,
		).toBeUndefined();
		expect(
			(
				assistant.content[1]?.providerMetadata as {
					openai?: { itemId?: string };
				}
			)?.openai?.itemId,
		).toBeUndefined();
	});

	test("leaves non-gpt providers untouched", () => {
		const messages: CoreMessage[] = [
			{
				role: "assistant",
				content: [
					{
						type: "text",
						text: "hello",
						providerOptions: {
							openai: { itemId: "msg_123", phase: "final_answer" },
						},
					},
				],
			} as unknown as CoreMessage,
		];

		expect(
			stripOpenAIItemIdsFromHistory(messages, "anthropic/claude-sonnet-4-5"),
		).toBe(messages);
	});
});

describe("applyContextPruning", () => {
	test("balanced mode prunes stale tool history", () => {
		const messages: CoreMessage[] = [
			{ role: "user", content: "u1" },
			{
				role: "assistant",
				content: [
					{ type: "tool-call", toolCallId: "a", toolName: "read", input: {} },
				],
			} as unknown as CoreMessage,
			{
				role: "tool",
				content: [
					{
						type: "tool-result",
						toolCallId: "a",
						toolName: "read",
						output: { text: "payload" },
					},
				],
			} as unknown as CoreMessage,
			{ role: "user", content: "u2" },
			{ role: "assistant", content: "a2" },
			{ role: "user", content: "u3" },
			{ role: "assistant", content: "a3" },
			{ role: "user", content: "u4" },
		];

		const pruned = applyContextPruning(messages, "balanced");
		expect(pruned.length).toBeLessThan(messages.length);
		expect(pruned[pruned.length - 1]?.role).toBe("user");
	});
});

describe("getMessageDiagnostics", () => {
	test("aggregates role and tool-result byte stats", () => {
		const messages: CoreMessage[] = [
			{ role: "user", content: "hello" },
			{
				role: "tool",
				content: [
					{
						type: "tool-result",
						toolCallId: "1",
						toolName: "read",
						output: { value: "abc" },
					},
				],
			} as unknown as CoreMessage,
		];

		const diagnostics = getMessageDiagnostics(messages);
		expect(diagnostics.messageCount).toBe(2);
		expect(diagnostics.totalBytes).toBeGreaterThan(0);
		expect(diagnostics.roleBreakdown.user?.count).toBe(1);
		expect(diagnostics.toolResults.count).toBe(1);
		expect(diagnostics.toolResults.topContributors[0]?.toolName).toBe("read");
	});
});

describe("compactToolResultPayloads", () => {
	test("compacts oversized tool payloads with truncation metadata", () => {
		const largePayload = "x".repeat(10_000);
		const messages: CoreMessage[] = [
			{
				role: "tool",
				content: [
					{
						type: "tool-result",
						toolCallId: "1",
						toolName: "read",
						output: { blob: largePayload },
					},
				],
			} as unknown as CoreMessage,
		];

		const compacted = compactToolResultPayloads(messages, 1024);
		const part = (compacted[0] as { content: Array<Record<string, unknown>> })
			.content[0];
		expect(part?.output).toMatchObject({
			truncated: true,
			strategy: "head-tail",
		});
	});
});
