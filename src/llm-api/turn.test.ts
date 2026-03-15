import { describe, expect, test } from "bun:test";
import {
	getReasoningDeltaFromStreamChunk,
	isOpenAIGPT,
	normalizeOpenAICompatibleToolCallInputs,
	sanitizeGeminiToolMessages,
	stripGPTCommentaryFromHistory,
	stripOpenAIItemIdsFromHistory,
	stripToolRuntimeInputFields,
} from "./history-transforms.ts";
import type { CoreMessage } from "./turn.ts";
import {
	annotateAnthropicCacheBreakpoints,
	applyContextPruning,
	compactToolResultPayloads,
	getMessageDiagnostics,
} from "./turn-context.ts";

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

describe("normalizeOpenAICompatibleToolCallInputs", () => {
	const makeAssistantToolCallMessages = (input: string): CoreMessage[] => [
		{
			role: "assistant",
			content: [
				{
					type: "tool-call",
					toolCallId: "call_1",
					toolName: "read",
					input,
				},
			],
		} as unknown as CoreMessage,
	];

	test("parses stringified object tool-call input for zen openai-compatible chat models", () => {
		const messages = makeAssistantToolCallMessages('{"path":"TODO.md"}');

		const normalized = normalizeOpenAICompatibleToolCallInputs(
			messages,
			"zen/glm-5",
		);
		const part = (normalized[0] as { content: Array<Record<string, unknown>> })
			.content[0];
		expect(part?.input).toEqual({ path: "TODO.md" });
	});

	test("leaves non-object parsed inputs unchanged", () => {
		const messages = makeAssistantToolCallMessages('"raw-string"');

		const normalized = normalizeOpenAICompatibleToolCallInputs(
			messages,
			"zen/glm-5",
		);
		expect(normalized).toBe(messages);
	});

	test("does not run for non zen-openai-compatible models", () => {
		const messages = makeAssistantToolCallMessages('{"path":"TODO.md"}');

		expect(
			normalizeOpenAICompatibleToolCallInputs(messages, "zen/gpt-5.3-codex"),
		).toBe(messages);
		expect(
			normalizeOpenAICompatibleToolCallInputs(messages, "openai/gpt-4o"),
		).toBe(messages);
	});
});

describe("stripToolRuntimeInputFields", () => {
	test("strips runtime-only tool fields from assistant tool-call inputs", () => {
		const messages: CoreMessage[] = [
			{
				role: "assistant",
				content: [
					{
						type: "tool-call",
						toolCallId: "call_1",
						toolName: "read",
						input: {
							path: "TODO.md",
							line: 1,
							cwd: "/tmp/project",
							snapshotCallback: "ignore-me",
							onOutput: "ignore-me-too",
						},
					},
				],
			} as unknown as CoreMessage,
		];

		const stripped = stripToolRuntimeInputFields(messages);
		const part = (stripped[0] as { content: Array<Record<string, unknown>> })
			.content[0];
		expect(part?.input).toEqual({ path: "TODO.md", line: 1 });
	});

	test("leaves non-assistant messages and clean tool calls untouched", () => {
		const messages: CoreMessage[] = [
			{ role: "user", content: "hi" },
			{
				role: "assistant",
				content: [
					{
						type: "tool-call",
						toolCallId: "call_2",
						toolName: "read",
						input: { path: "TODO.md" },
					},
				],
			} as unknown as CoreMessage,
		];

		expect(stripToolRuntimeInputFields(messages)).toBe(messages);
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
	const healthyGeminiToolTurn = (userContent: string): CoreMessage[] =>
		[
			{ role: "user", content: userContent },
			{
				role: "assistant",
				content: [
					{
						type: "tool-call",
						toolCallId: "healthy-call",
						toolName: "read",
						input: {},
						providerOptions: { google: { thoughtSignature: "sig-ok" } },
					},
				],
			},
			{
				role: "tool",
				content: [
					{
						type: "tool-result",
						toolCallId: "healthy-call",
						toolName: "read",
						output: { type: "json", value: { ok: true } },
					},
				],
			},
		] as unknown as CoreMessage[];

	const brokenGeminiToolTurn = (toolCallId = "broken-call"): CoreMessage[] =>
		[
			{
				role: "assistant",
				content: [
					{
						type: "tool-call",
						toolCallId,
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
						toolCallId,
						toolName: "replace",
						output: { type: "json", value: { ok: false } },
					},
				],
			},
		] as unknown as CoreMessage[];

	test("valid signed single call preserved", () => {
		const messages: CoreMessage[] = [
			{ role: "user", content: "current turn" },
			{
				role: "assistant",
				content: [
					{
						type: "tool-call",
						toolCallId: "call-1",
						toolName: "read",
						input: {},
						providerOptions: { google: { thoughtSignature: "sig-1" } },
					},
				],
			} as unknown as CoreMessage,
		];

		expect(
			sanitizeGeminiToolMessages(messages, "google/gemini-2.5-pro", true),
		).toEqual(messages);
	});

	test("valid parallel calls with only first signed preserved", () => {
		const messages: CoreMessage[] = [
			{ role: "user", content: "parallel call turn" },
			{
				role: "assistant",
				content: [
					{
						type: "tool-call",
						toolCallId: "signed-anchor",
						toolName: "read",
						input: {},
						providerOptions: { google: { thoughtSignature: "sig-anchor" } },
					},
					{
						type: "tool-call",
						toolCallId: "unsigned-followup",
						toolName: "replace",
						input: {},
					},
				],
			} as unknown as CoreMessage,
		];

		expect(
			sanitizeGeminiToolMessages(messages, "zen/gemini-3.1-pro", true),
		).toEqual(messages);
	});

	test("legacy providerMetadata recognized and normalized into providerOptions", () => {
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
						providerMetadata: { google: { thoughtSignature: "sig-legacy" } },
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
			google: { thoughtSignature: "sig-legacy" },
		});
	});

	test("malformed assistant/tool before current user preserves that user and later messages", () => {
		const messages = [
			...healthyGeminiToolTurn("healthy turn"),
			...brokenGeminiToolTurn(),
			{ role: "user", content: "current prompt" },
			{ role: "assistant", content: "plain response" },
		] as unknown as CoreMessage[];

		expect(
			sanitizeGeminiToolMessages(messages, "google/gemini-2.5-pro", true),
		).toEqual([...messages.slice(0, 3), ...messages.slice(5)]);
	});

	test("malformed latest turn without trailing user still truncates tail from broken assistant onward", () => {
		const messages = [
			...healthyGeminiToolTurn("healthy turn"),
			{ role: "user", content: "latest turn" },
			...brokenGeminiToolTurn(),
		] as unknown as CoreMessage[];

		expect(
			sanitizeGeminiToolMessages(messages, "google/gemini-2.5-pro", true),
		).toEqual(messages.slice(0, 4));
	});

	test("earlier valid turns remain when latest turn repaired", () => {
		const messages = [
			{ role: "user", content: "turn 1" },
			{
				role: "assistant",
				content: [
					{
						type: "tool-call",
						toolCallId: "turn1-call",
						toolName: "read",
						input: {},
						providerOptions: { google: { thoughtSignature: "sig-turn1" } },
					},
				],
			},
			{
				role: "tool",
				content: [
					{
						type: "tool-result",
						toolCallId: "turn1-call",
						toolName: "read",
						output: { type: "json", value: { data: 1 } },
					},
				],
			},
			{ role: "user", content: "turn 2" },
			{
				role: "assistant",
				content: [
					{
						type: "tool-call",
						toolCallId: "turn2-broken",
						toolName: "replace",
						input: {},
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

	test("non-Gemini untouched", () => {
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
			} as unknown as CoreMessage,
		];

		expect(sanitizeGeminiToolMessages(messages, "openai/gpt-4o", true)).toEqual(
			messages,
		);
	});

	test("no Gemini tool-call assistant messages => no-op", () => {
		const messages: CoreMessage[] = [
			{ role: "user", content: "hello" },
			{ role: "assistant", content: "plain text response" },
			{ role: "user", content: "next" },
			{
				role: "tool",
				content: [
					{
						type: "tool-result",
						toolCallId: "orphan",
						toolName: "read",
						output: { type: "text", value: "ok" },
					},
				],
			} as unknown as CoreMessage,
		];

		expect(
			sanitizeGeminiToolMessages(messages, "google/gemini-2.5-pro", true),
		).toEqual(messages);
	});

	test("regression: sanitizer no longer removes up to next user turn for older broken turns", () => {
		const messages = [
			{ role: "user", content: "older broken turn" },
			{
				role: "assistant",
				content: [
					{
						type: "tool-call",
						toolCallId: "older-broken",
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
						toolCallId: "older-broken",
						toolName: "replace",
						output: { type: "json", value: { stale: true } },
					},
				],
			},
			{ role: "user", content: "latest turn" },
			{
				role: "assistant",
				content: [
					{
						type: "tool-call",
						toolCallId: "latest-valid",
						toolName: "read",
						input: {},
						providerOptions: { google: { thoughtSignature: "sig-latest" } },
					},
				],
			},
		] as unknown as CoreMessage[];

		expect(
			sanitizeGeminiToolMessages(messages, "google/gemini-2.5-pro", true),
		).toEqual(messages);
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
	test("balanced mode does not prune sessions shorter than 40 messages", () => {
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
		// 8 messages < 40 threshold — nothing should be pruned
		expect(pruned.length).toBe(messages.length);
	});

	test("balanced mode prunes stale tool history in large sessions", () => {
		// Build a history of 50 messages (25 user+assistant pairs with tool calls)
		const messages: CoreMessage[] = [];
		for (let i = 0; i < 25; i++) {
			messages.push({ role: "user", content: `u${i}` });
			messages.push({
				role: "assistant",
				content: [
					{
						type: "tool-call",
						toolCallId: `tc${i}`,
						toolName: "read",
						input: {},
					},
				],
			} as unknown as CoreMessage);
			messages.push({
				role: "tool",
				content: [
					{
						type: "tool-result",
						toolCallId: `tc${i}`,
						toolName: "read",
						output: { text: `result ${i}` },
					},
				],
			} as unknown as CoreMessage);
		}
		messages.push({ role: "user", content: "final" });

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
	function expectCompactedJsonOutput(output: unknown): void {
		const messages: CoreMessage[] = [
			{
				role: "tool",
				content: [
					{
						type: "tool-result",
						toolCallId: "1",
						toolName: "read",
						output,
					},
				],
			} as unknown as CoreMessage,
		];

		const compacted = compactToolResultPayloads(messages, 1024);
		const part = (compacted[0] as { content: Array<Record<string, unknown>> })
			.content[0];
		expect(part?.output).toMatchObject({
			type: "json",
			value: {
				truncated: true,
				strategy: "head-tail",
			},
		});
	}

	test("compacts oversized tool payloads without breaking output schema", () => {
		const largePayload = "x".repeat(10_000);
		expectCompactedJsonOutput({ type: "json", value: { blob: largePayload } });
	});

	test("wraps compacted legacy raw output into json output schema", () => {
		const largePayload = "x".repeat(10_000);
		expectCompactedJsonOutput({ blob: largePayload });
	});

	test("rewraps compacted typed text output into json schema", () => {
		const largePayload = "x".repeat(10_000);
		expectCompactedJsonOutput({ type: "text", value: largePayload });
	});
});

describe("annotateAnthropicCacheBreakpoints", () => {
	test("adds cache control to system prompt and removes it from returned systemPrompt", () => {
		const messages: CoreMessage[] = [{ role: "user", content: "hello" }];
		const {
			messages: annotated,
			systemPrompt,
			diagnostics,
		} = annotateAnthropicCacheBreakpoints(messages, "System rules");

		expect(systemPrompt).toBeUndefined();
		expect(annotated.length).toBe(2);
		expect(annotated[0]).toEqual({
			role: "system",
			content: "System rules",
			providerOptions: {
				anthropic: { cacheControl: { type: "ephemeral" } },
			},
		});
		expect(diagnostics.breakpointsAdded).toBe(1);
	});

	test("adds breakpoint to second to last message if there are enough messages", () => {
		const messages: CoreMessage[] = [
			{ role: "user", content: "m1" },
			{ role: "assistant", content: "m2" },
			{ role: "user", content: "m3" },
			{ role: "assistant", content: "m4" },
		];
		const {
			messages: annotated,
			systemPrompt,
			diagnostics,
		} = annotateAnthropicCacheBreakpoints(messages, undefined);

		expect(systemPrompt).toBeUndefined();
		expect(annotated.length).toBe(4);
		// 2nd to last message is index 2 (m3)
		expect(annotated[2]).toEqual({
			role: "user",
			content: "m3",
			providerOptions: {
				anthropic: { cacheControl: { type: "ephemeral" } },
			},
		});
		expect(annotated[3]?.providerOptions).toBeUndefined();
		expect(diagnostics.breakpointsAdded).toBe(1);
	});

	test("handles system prompt and second to last message together", () => {
		const messages: CoreMessage[] = [
			{ role: "user", content: "m1" },
			{ role: "assistant", content: "m2" },
			{ role: "user", content: "m3" },
		];
		const {
			messages: annotated,
			systemPrompt,
			diagnostics,
		} = annotateAnthropicCacheBreakpoints(messages, "System rules");

		expect(systemPrompt).toBeUndefined();
		expect(annotated.length).toBe(4);

		// system message
		expect(annotated[0]).toEqual({
			role: "system",
			content: "System rules",
			providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } },
		});

		// 2nd to last message was index 1 of the original array, which is "assistant m2".
		// Now it is at index 2 of annotated array.
		expect(annotated[2]).toEqual({
			role: "assistant",
			content: "m2",
			providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } },
		});

		expect(diagnostics.breakpointsAdded).toBe(2);
	});
});
