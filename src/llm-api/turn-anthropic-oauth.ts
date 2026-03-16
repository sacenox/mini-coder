import Anthropic from "@anthropic-ai/sdk";
import type {
	ContentBlockParam,
	MessageCreateParamsStreaming,
	MessageParam,
} from "@anthropic-ai/sdk/resources/messages.js";
import { zodSchema } from "ai";

import { isApiLogEnabled, logApiEvent } from "./api-log.ts";
import { normalizeUnknownError } from "./error-utils.ts";
import type { ThinkingEffort } from "./provider-options.ts";
import type { CoreMessage } from "./turn.ts";
import {
	type ContextPruningMode,
	DEFAULT_TOOL_RESULT_PAYLOAD_CAP_BYTES,
} from "./turn-context.ts";
import { buildTurnPreparation } from "./turn-request.ts";
import type { ToolDef, TurnEvent } from "./types.ts";

const MAX_STEPS = 50;
const MAX_OUTPUT_TOKENS = 16384;
const CC_VERSION = "2.1.75";

// ─── Anthropic client management ──────────────────────────────────────────────

let cachedClient: { token: string; client: Anthropic } | null = null;

function getClient(token: string): Anthropic {
	if (cachedClient?.token === token && cachedClient.client)
		return cachedClient.client;
	const client = new Anthropic({
		apiKey: null,
		authToken: token,
		maxRetries: 5,
		dangerouslyAllowBrowser: true,
		defaultHeaders: {
			accept: "application/json",
			"anthropic-dangerous-direct-browser-access": "true",
			"anthropic-beta": "claude-code-20250219,oauth-2025-04-20",
			"user-agent": `claude-cli/${CC_VERSION}`,
			"x-app": "cli",
		},
	});
	cachedClient = { token, client };
	return client;
}

// ─── Thinking / effort helpers ────────────────────────────────────────────────

function supportsAdaptiveThinking(modelId: string): boolean {
	return modelId.includes("opus-4-6") || modelId.includes("sonnet-4-6");
}

function mapEffort(
	effort: ThinkingEffort | undefined,
	modelId: string,
): string | undefined {
	if (!effort) return undefined;
	const map: Record<ThinkingEffort, string> = {
		low: "low",
		medium: "medium",
		high: "high",
		xhigh: modelId.includes("opus-4-6") ? "max" : "high",
	};
	return map[effort];
}

// ─── Message conversion: CoreMessage[] → Anthropic MessageParam[] ─────────────

// CoreMessage content parts are loosely typed (round-tripped from SQLite JSON)
// so we cast through a minimal record type to access provider-specific fields.
type Msg = { role: string; content: unknown };
type Part = Record<string, unknown>;

function coreToAnthropicMessages(messages: CoreMessage[]): {
	system: string | undefined;
	params: MessageParam[];
} {
	let systemPrompt: string | undefined;
	const params: MessageParam[] = [];

	// First pass: collect all tool_use IDs so we can drop orphaned tool_results
	// (context pruning may remove assistant messages with tool_use blocks while
	// keeping the user messages with their tool_result blocks).
	const toolUseIds = new Set<string>();
	for (const msg of messages as unknown as Msg[]) {
		if (msg.role !== "assistant" || !Array.isArray(msg.content)) continue;
		for (const part of msg.content as Part[]) {
			if (part.type === "tool-call" && part.toolCallId) {
				toolUseIds.add(part.toolCallId as string);
			}
		}
	}

	for (const msg of messages as unknown as Msg[]) {
		if (msg.role === "system") {
			systemPrompt =
				typeof msg.content === "string"
					? msg.content
					: Array.isArray(msg.content)
						? (msg.content as Part[])
								.filter((p) => p.type === "text")
								.map((p) => p.text as string)
								.join("\n")
						: undefined;
			continue;
		}

		if (msg.role === "user") {
			if (typeof msg.content === "string") {
				if (msg.content.trim())
					params.push({ role: "user", content: msg.content });
				continue;
			}
			if (Array.isArray(msg.content)) {
				const blocks: ContentBlockParam[] = [];
				for (const part of msg.content as Part[]) {
					if (part.type === "text" && (part.text as string)?.trim()) {
						blocks.push({ type: "text", text: part.text as string });
					} else if (part.type === "tool-result") {
						// Drop orphaned tool_results whose tool_use was pruned
						if (!toolUseIds.has(part.toolCallId as string)) continue;
						blocks.push({
							type: "tool_result",
							tool_use_id: part.toolCallId,
							content:
								typeof part.result === "string"
									? part.result
									: JSON.stringify(part.result ?? part.output ?? ""),
							is_error: part.isError ?? false,
						} as ContentBlockParam);
					} else if (part.type === "image") {
						blocks.push({
							type: "image",
							source: {
								type: "base64",
								media_type: part.mimeType ?? "image/png",
								data: part.data,
							},
						} as ContentBlockParam);
					}
				}
				if (blocks.length > 0) params.push({ role: "user", content: blocks });
			}
			continue;
		}

		if (msg.role === "assistant") {
			if (typeof msg.content === "string") {
				if (msg.content.trim())
					params.push({ role: "assistant", content: msg.content });
				continue;
			}
			if (Array.isArray(msg.content)) {
				const blocks: ContentBlockParam[] = [];
				for (const part of msg.content as Part[]) {
					if (part.type === "text" && (part.text as string)?.trim()) {
						blocks.push({ type: "text", text: part.text as string });
					} else if (part.type === "tool-call") {
						blocks.push({
							type: "tool_use",
							id: part.toolCallId,
							name: part.toolName,
							input: part.args ?? {},
						} as ContentBlockParam);
					} else if (part.type === "thinking") {
						if (part.redacted && part.signature) {
							blocks.push({
								type: "redacted_thinking",
								data: part.signature,
							} as ContentBlockParam);
						} else if (
							(part.text as string)?.trim() &&
							(part.signature as string)?.trim()
						) {
							blocks.push({
								type: "thinking",
								thinking: part.text,
								signature: part.signature,
							} as ContentBlockParam);
						}
					}
				}
				if (blocks.length > 0)
					params.push({ role: "assistant", content: blocks });
			}
		}
	}

	return { system: systemPrompt, params };
}

// ─── Tool conversion: ToolDef[] → Anthropic Tool[] ────────────────────────────

function convertTools(tools: ToolDef[]): Anthropic.Messages.Tool[] {
	return tools.map((tool) => {
		const schema = zodSchema(tool.schema as Parameters<typeof zodSchema>[0])
			.jsonSchema as {
			properties?: Record<string, unknown>;
			required?: string[];
		};
		return {
			name: tool.name,
			description: tool.description,
			input_schema: {
				type: "object" as const,
				properties: schema.properties ?? {},
				required: schema.required ?? [],
			},
		};
	});
}

// ─── Response conversion: Anthropic → CoreMessage[] ───────────────────────────

interface ToolCallCollected {
	id: string;
	name: string;
	args: unknown;
}

interface ToolResultCollected {
	toolCallId: string;
	toolName: string;
	result: unknown;
	isError: boolean;
}

function buildCoreMessages(
	assistantText: string,
	thinkingBlocks: Array<{
		text: string;
		signature: string;
		redacted?: boolean;
	}>,
	toolCalls: ToolCallCollected[],
	toolResults: ToolResultCollected[],
): CoreMessage[] {
	const messages: CoreMessage[] = [];

	// Assistant message with text + thinking + tool calls
	const parts: unknown[] = [];
	for (const tb of thinkingBlocks) {
		if (tb.redacted) {
			parts.push({
				type: "thinking",
				text: "[Reasoning redacted]",
				signature: tb.signature,
				redacted: true,
			});
		} else {
			parts.push({
				type: "thinking",
				text: tb.text,
				signature: tb.signature,
			});
		}
	}
	if (assistantText.trim()) {
		parts.push({ type: "text", text: assistantText });
	}
	for (const tc of toolCalls) {
		parts.push({
			type: "tool-call",
			toolCallId: tc.id,
			toolName: tc.name,
			args: tc.args,
		});
	}
	if (parts.length > 0) {
		messages.push({
			role: "assistant",
			content: parts,
		} as unknown as CoreMessage);
	}

	// Tool results as user message
	if (toolResults.length > 0) {
		const resultParts = toolResults.map((tr) => ({
			type: "tool-result" as const,
			toolCallId: tr.toolCallId,
			toolName: tr.toolName,
			result: tr.result,
			isError: tr.isError,
		}));
		messages.push({
			role: "user",
			content: resultParts,
		} as unknown as CoreMessage);
	}

	return messages;
}

// ─── parseStreamingJson (for partial tool input) ──────────────────────────────

function parseStreamingJson(partial: string): Record<string, unknown> {
	try {
		return JSON.parse(partial);
	} catch {
		try {
			// Try closing open braces
			let fixed = partial;
			const opens = (fixed.match(/{/g) || []).length;
			const closes = (fixed.match(/}/g) || []).length;
			for (let i = 0; i < opens - closes; i++) fixed += "}";
			return JSON.parse(fixed);
		} catch {
			return {};
		}
	}
}

// ─── Main entry point ─────────────────────────────────────────────────────────

export async function* runTurnAnthropicOAuth(options: {
	token: string;
	modelString: string;
	messages: CoreMessage[];
	tools: ToolDef[];
	systemPrompt?: string;
	signal?: AbortSignal;
	thinkingEffort?: ThinkingEffort;
	pruningMode?: ContextPruningMode;
	toolResultPayloadCapBytes?: number;
	promptCachingEnabled?: boolean;
}): AsyncGenerator<TurnEvent> {
	const {
		token,
		modelString,
		messages,
		tools,
		systemPrompt,
		signal,
		thinkingEffort,
		pruningMode = "balanced",
		promptCachingEnabled = true,
		toolResultPayloadCapBytes = DEFAULT_TOOL_RESULT_PAYLOAD_CAP_BYTES,
	} = options;

	const modelId = modelString.replace(/^anthropic\//, "");
	const client = getClient(token);
	const anthropicTools = convertTools(tools);
	const toolExecutors = new Map(tools.map((t) => [t.name, t.execute]));

	// Track totals
	let totalInputTokens = 0;
	let totalOutputTokens = 0;
	let contextTokens = 0;
	let stepCount = 0;
	const allNewMessages: CoreMessage[] = [];

	try {
		// Prepare messages (pruning, compaction, cache breakpoints)
		const { prepared } = buildTurnPreparation({
			modelString,
			messages,
			thinkingEffort,
			promptCachingEnabled,
			openaiPromptCacheRetention: "in_memory",
			googleCachedContent: null,
			toolCount: tools.length,
			systemPrompt,
			pruningMode,
			toolResultPayloadCapBytes,
		});

		logApiEvent("turn start", {
			modelString,
			messageCount: messages.length,
			reasoningSummaryRequested: false,
			pruningMode,
			toolResultPayloadCapBytes,
		});

		if (prepared.pruned) {
			yield {
				type: "context-pruned",
				mode: pruningMode as "balanced" | "aggressive",
				beforeMessageCount: prepared.prePruneMessageCount,
				afterMessageCount: prepared.postPruneMessageCount,
				removedMessageCount:
					prepared.prePruneMessageCount - prepared.postPruneMessageCount,
				beforeTotalBytes: prepared.prePruneTotalBytes,
				afterTotalBytes: prepared.postPruneTotalBytes,
				removedBytes:
					prepared.prePruneTotalBytes - prepared.postPruneTotalBytes,
			};
		}

		// Convert prepared messages to Anthropic format
		const { system: extractedSystem, params: anthropicMessages } =
			coreToAnthropicMessages(prepared.messages);

		// Build system prompt array — CC identity MUST be a separate first block
		const ccPrefix =
			"You are Claude Code, Anthropic's official CLI for Claude.";
		const sysText = prepared.systemPrompt ?? extractedSystem;
		const systemBlocks: Anthropic.Messages.TextBlockParam[] = [
			{
				type: "text",
				text: ccPrefix,
				cache_control: { type: "ephemeral" },
			},
		];
		if (sysText) {
			// Strip the CC prefix if it was already prepended
			const clean = sysText.startsWith(ccPrefix)
				? sysText.slice(ccPrefix.length).replace(/^\n/, "")
				: sysText;
			if (clean.trim()) {
				systemBlocks.push({
					type: "text",
					text: clean,
					cache_control: { type: "ephemeral" },
				});
			}
		}

		// Multi-step loop
		const currentMessages = [...anthropicMessages];

		while (stepCount < MAX_STEPS) {
			stepCount++;
			const isLastStep = stepCount >= MAX_STEPS;

			const params: MessageCreateParamsStreaming = {
				model: modelId,
				max_tokens: MAX_OUTPUT_TOKENS,
				system: systemBlocks,
				messages: currentMessages,
				tools: isLastStep ? [] : anthropicTools,
				stream: true,
			};

			// Configure thinking
			if (thinkingEffort && supportsAdaptiveThinking(modelId)) {
				params.thinking = { type: "adaptive" };
				const effort = mapEffort(thinkingEffort, modelId);
				if (effort) {
					(params as unknown as Record<string, unknown>).output_config = {
						effort,
					};
				}
			}

			// Manage cache_control: max 4 total (2 system + up to 2 in messages).
			// Remove old cache_control from messages and add to the last user message.
			for (const m of currentMessages) {
				if (!Array.isArray(m.content)) continue;
				for (const block of m.content) {
					if (typeof block === "object" && block !== null) {
						delete (block as unknown as Record<string, unknown>).cache_control;
					}
				}
			}
			// Add cache_control to last user message's last block
			const lastMsg =
				currentMessages.length > 0
					? currentMessages[currentMessages.length - 1]
					: undefined;
			if (
				lastMsg &&
				lastMsg.role === "user" &&
				Array.isArray(lastMsg.content)
			) {
				const lastBlock = lastMsg.content[lastMsg.content.length - 1];
				if (lastBlock && typeof lastBlock === "object") {
					(lastBlock as unknown as Record<string, unknown>).cache_control = {
						type: "ephemeral",
					};
				}
			}

			if (isApiLogEnabled()) {
				logApiEvent("Provider Request", {
					url: "https://api.anthropic.com/v1/messages",
					method: "POST",
					model: modelId,
					messageCount: currentMessages.length,
					toolCount: params.tools?.length ?? 0,
				});
			}

			// Use non-streaming create with retries, then convert to stream behavior.
			// The SDK's .stream() method doesn't retry on 500, but .create() does
			// when maxRetries is set.
			const stream = client.messages.stream(params, { signal });
			let assistantText = "";
			const thinkingBlocks: Array<{
				text: string;
				signature: string;
				redacted?: boolean;
			}> = [];
			const toolCalls: ToolCallCollected[] = [];
			let partialJson = "";
			let currentToolId = "";
			let currentToolName = "";
			let stepInputTokens = 0;
			let stepOutputTokens = 0;
			let stopReason: string | undefined;

			for await (const event of stream) {
				if (event.type === "message_start") {
					stepInputTokens = event.message.usage.input_tokens || 0;
					stepOutputTokens = event.message.usage.output_tokens || 0;
				} else if (event.type === "content_block_start") {
					if (event.content_block.type === "text") {
						// text block starting
					} else if (event.content_block.type === "thinking") {
						thinkingBlocks.push({
							text: "",
							signature: "",
						});
					} else if (event.content_block.type === "redacted_thinking") {
						thinkingBlocks.push({
							text: "[Reasoning redacted]",
							signature: (event.content_block as { data: string }).data,
							redacted: true,
						});
					} else if (event.content_block.type === "tool_use") {
						currentToolId = event.content_block.id;
						currentToolName = event.content_block.name;
						partialJson = "";
					}
				} else if (event.type === "content_block_delta") {
					if (event.delta.type === "text_delta") {
						assistantText += event.delta.text;
						yield { type: "text-delta", delta: event.delta.text };
					} else if (event.delta.type === "thinking_delta") {
						const tb = thinkingBlocks[thinkingBlocks.length - 1];
						if (tb) tb.text += event.delta.thinking;
						yield {
							type: "reasoning-delta",
							delta: event.delta.thinking,
						};
					} else if (event.delta.type === "input_json_delta") {
						partialJson += event.delta.partial_json;
					} else if (event.delta.type === "signature_delta") {
						const tb = thinkingBlocks[thinkingBlocks.length - 1];
						if (tb) tb.signature += event.delta.signature;
					}
				} else if (event.type === "content_block_stop") {
					if (currentToolId && currentToolName) {
						const args = parseStreamingJson(partialJson);
						toolCalls.push({
							id: currentToolId,
							name: currentToolName,
							args,
						});
						yield {
							type: "tool-call-start",
							toolCallId: currentToolId,
							toolName: currentToolName,
							args,
						};
						currentToolId = "";
						currentToolName = "";
						partialJson = "";
					}
				} else if (event.type === "message_delta") {
					if (event.delta.stop_reason) {
						stopReason = event.delta.stop_reason;
					}
					if (event.usage.output_tokens != null) {
						stepOutputTokens = event.usage.output_tokens;
					}
				}
			}

			totalInputTokens += stepInputTokens;
			totalOutputTokens += stepOutputTokens;
			contextTokens = stepInputTokens;

			logApiEvent("step finish", {
				stepNumber: stepCount,
				finishReason: stopReason,
				usage: {
					inputTokens: stepInputTokens,
					outputTokens: stepOutputTokens,
				},
			});

			// Execute tool calls if any
			const toolResults: ToolResultCollected[] = [];
			if (stopReason === "tool_use" && toolCalls.length > 0) {
				for (const tc of toolCalls) {
					const executor = toolExecutors.get(tc.name);
					let result: unknown;
					let isError = false;
					if (!executor) {
						result = `Unknown tool: ${tc.name}`;
						isError = true;
					} else {
						try {
							result = await executor(tc.args);
						} catch (err) {
							result = normalizeUnknownError(err).message;
							isError = true;
						}
					}
					toolResults.push({
						toolCallId: tc.id,
						toolName: tc.name,
						result,
						isError,
					});
					yield {
						type: "tool-result",
						toolCallId: tc.id,
						toolName: tc.name,
						result,
						isError,
					};
				}
			}

			// Build CoreMessages for this step
			const stepMessages = buildCoreMessages(
				assistantText,
				thinkingBlocks,
				toolCalls,
				toolResults,
			);
			allNewMessages.push(...stepMessages);

			// If no tool calls or end of turn, we're done
			if (stopReason !== "tool_use" || toolCalls.length === 0) {
				break;
			}

			// Append assistant + tool results to conversation for next step
			const assistantBlocks: ContentBlockParam[] = [];
			for (const tb of thinkingBlocks) {
				if (tb.redacted) {
					assistantBlocks.push({
						type: "redacted_thinking",
						data: tb.signature,
					} as ContentBlockParam);
				} else if (tb.text.trim() && tb.signature.trim()) {
					assistantBlocks.push({
						type: "thinking",
						thinking: tb.text,
						signature: tb.signature,
					} as ContentBlockParam);
				}
			}
			if (assistantText.trim()) {
				assistantBlocks.push({ type: "text", text: assistantText });
			}
			for (const tc of toolCalls) {
				assistantBlocks.push({
					type: "tool_use",
					id: tc.id,
					name: tc.name,
					input: tc.args as Record<string, unknown>,
				});
			}
			currentMessages.push({
				role: "assistant",
				content: assistantBlocks,
			});

			const resultBlocks: ContentBlockParam[] = toolResults.map((tr) => ({
				type: "tool_result" as const,
				tool_use_id: tr.toolCallId,
				content:
					typeof tr.result === "string"
						? tr.result
						: JSON.stringify(tr.result ?? ""),
				is_error: tr.isError,
			}));
			currentMessages.push({ role: "user", content: resultBlocks });
		}

		logApiEvent("turn complete", {
			newMessagesCount: allNewMessages.length,
			inputTokens: totalInputTokens,
			outputTokens: totalOutputTokens,
		});

		yield {
			type: "turn-complete",
			inputTokens: totalInputTokens,
			outputTokens: totalOutputTokens,
			contextTokens,
			messages: allNewMessages,
		};
	} catch (err) {
		const normalizedError = normalizeUnknownError(err);
		logApiEvent("turn error", normalizedError);
		yield {
			type: "turn-error",
			error: normalizedError,
			partialMessages: allNewMessages,
		};
	}
}
