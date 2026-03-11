import type { FlexibleSchema, StepResult } from "ai";
import { dynamicTool, jsonSchema, stepCountIs, streamText } from "ai";
import { logApiEvent } from "./api-log.ts";
import {
	getThinkingProviderOptions,
	parseModelString,
	shouldDisableGeminiThinkingForTools,
	type ThinkingEffort,
} from "./providers.ts";
import type { ToolDef, TurnEvent } from "./types.ts";

type StreamTextOptions = Parameters<typeof streamText>[0];
export type CoreMessage = NonNullable<StreamTextOptions["messages"]>[number];
type CoreModel = StreamTextOptions["model"];
type ToolSet = NonNullable<StreamTextOptions["tools"]>;
type ToolEntry = ToolSet extends Record<string, infer T> ? T : never;
type StreamChunk = { type?: string; [key: string]: unknown };

export function getReasoningDeltaFromStreamChunk(
	chunk: StreamChunk,
): string | null {
	if (chunk.type !== "reasoning-delta" && chunk.type !== "reasoning") {
		return null;
	}
	if (typeof chunk.text === "string") return chunk.text;
	if (typeof chunk.textDelta === "string") return chunk.textDelta;
	return "";
}

type StreamTextResult = ReturnType<typeof streamText>;
type StreamTextResultFull = StreamTextResult & {
	fullStream: AsyncIterable<StreamChunk>;
	response: Promise<{ messages?: CoreMessage[] }>;
};

const MAX_STEPS = 50;
// ─── Helpers ──────────────────────────────────────────────────────────────────

function isZodSchema(s: unknown): boolean {
	// Zod schemas have a _def property; plain JSON Schema objects don't.
	return s !== null && typeof s === "object" && "_def" in (s as object);
}

function toCoreTool(def: ToolDef): ReturnType<typeof dynamicTool> {
	// MCP tools pass raw JSON Schema objects; the AI SDK requires them to be
	// wrapped with jsonSchema(). Zod schemas are passed through as-is.
	const schema = isZodSchema(def.schema)
		? (def.schema as FlexibleSchema<unknown>)
		: jsonSchema(def.schema);
	return dynamicTool({
		description: def.description,
		inputSchema: schema,
		execute: async (input: unknown) => {
			try {
				return await def.execute(input);
			} catch (err) {
				throw err instanceof Error ? err : new Error(String(err));
			}
		},
	});
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object";
}

function normalizeProviderOptions<T>(part: T): T {
	if (!isRecord(part)) return part;
	if (
		part.providerOptions !== undefined ||
		part.providerMetadata === undefined
	) {
		return part;
	}
	return {
		...part,
		providerOptions: part.providerMetadata,
	} as T;
}

function normalizeMessageProviderOptions(message: CoreMessage): CoreMessage {
	if (!Array.isArray(message.content)) return message;
	return {
		...message,
		content: message.content.map((part) =>
			normalizeProviderOptions(part),
		) as CoreMessage["content"],
	} as CoreMessage;
}

function getGeminiThoughtSignature(part: unknown): string | null {
	if (!isRecord(part)) return null;
	const providerOptions = isRecord(part.providerOptions)
		? part.providerOptions
		: isRecord(part.providerMetadata)
			? part.providerMetadata
			: null;
	if (!providerOptions) return null;

	for (const provider of ["google", "vertex"] as const) {
		const metadata = providerOptions[provider];
		if (!isRecord(metadata)) continue;
		const signature = metadata.thoughtSignature;
		if (typeof signature === "string" && signature.length > 0) {
			return signature;
		}
	}

	return null;
}

function isToolCallPart(part: unknown): part is Record<string, unknown> {
	return isRecord(part) && part.type === "tool-call";
}

function assistantMessageHasUnsignedGeminiToolCall(
	message: CoreMessage,
): boolean {
	if (message.role !== "assistant" || !Array.isArray(message.content)) {
		return false;
	}

	for (const part of message.content) {
		if (!isToolCallPart(part)) continue;
		if (getGeminiThoughtSignature(part) === null) return true;
	}

	return false;
}

export function sanitizeGeminiToolMessages(
	messages: CoreMessage[],
	modelString: string,
	hasTools: boolean,
): CoreMessage[] {
	if (!hasTools || !shouldDisableGeminiThinkingForTools(modelString)) {
		return messages;
	}

	let sanitized = messages.map((message) =>
		normalizeMessageProviderOptions(message),
	);

	while (true) {
		const brokenIndex = sanitized.findIndex((message) =>
			assistantMessageHasUnsignedGeminiToolCall(message),
		);
		if (brokenIndex === -1) return sanitized;

		const nextUserIndex = sanitized.findIndex(
			(message, index) => index > brokenIndex && message.role === "user",
		);
		if (nextUserIndex !== -1) {
			sanitized = sanitized.slice(nextUserIndex);
			continue;
		}

		return sanitized.slice(0, brokenIndex);
	}
}

// ─── Main turn function ───────────────────────────────────────────────────────

/**
 * Returns true when the model string refers to an OpenAI GPT model, which uses
 * the Responses API and honours the `instructions` provider option as the
 * authoritative system prompt (rather than a system-role message in `input`).
 */
export function isOpenAIGPT(modelString: string): boolean {
	const { provider, modelId } = parseModelString(modelString);
	return (
		(provider === "openai" || provider === "zen") && modelId.startsWith("gpt-")
	);
}

/**
 * Run a single agent turn against the model.
 *
 * Yields TurnEvents as they arrive, then yields a final TurnCompleteEvent
 * (or TurnErrorEvent on failure).
 */
export async function* runTurn(options: {
	model: CoreModel;
	modelString: string;
	messages: CoreMessage[];
	tools: ToolDef[];
	systemPrompt?: string;
	signal?: AbortSignal;
	thinkingEffort?: ThinkingEffort;
}): AsyncGenerator<TurnEvent> {
	const {
		model,
		modelString,
		messages,
		tools,
		systemPrompt,
		signal,
		thinkingEffort,
	} = options;

	let stepCount = 0;
	const toolSet = {} as ToolSet;
	for (const def of tools) {
		(toolSet as Record<string, ToolEntry>)[def.name] = toCoreTool(def);
	}

	let inputTokens = 0;
	let outputTokens = 0;
	// Overwritten each step — after all steps this holds the last step's input
	// token count, which approximates context window usage (each step re-sends
	// the full conversation history, so later steps have larger prompts).
	let contextTokens = 0;

	const partialState = { messages: [] as CoreMessage[] };

	try {
		// OpenAI GPT models use the Responses API (@ai-sdk/openai v3 / ai v6 default),
		// which honours `instructions` as the authoritative system prompt. Passing it
		// as a system-role message in `input` works but is treated as a lower-priority
		// user turn, causing the model to deprioritise the instructions.
		const useInstructions =
			systemPrompt !== undefined && isOpenAIGPT(modelString);

		const toolCount = Object.keys(toolSet).length;
		const thinkingOpts = thinkingEffort
			? getThinkingProviderOptions(modelString, thinkingEffort, toolCount > 0)
			: null;
		const reasoningSummaryRequested =
			isRecord(thinkingOpts) &&
			isRecord(thinkingOpts.openai) &&
			typeof thinkingOpts.openai.reasoningSummary === "string";
		logApiEvent("turn start", {
			modelString,
			messageCount: messages.length,
			reasoningSummaryRequested,
		});

		const turnMessages = sanitizeGeminiToolMessages(
			messages,
			modelString,
			toolCount > 0,
		);
		if (turnMessages.length !== messages.length) {
			logApiEvent("gemini tool history truncated", {
				modelString,
				originalMessages: messages.length,
				sanitizedMessages: turnMessages.length,
			});
		}

		const mergedProviderOptions = {
			...(useInstructions
				? { openai: { instructions: systemPrompt, store: false } }
				: {}),
			...(thinkingOpts ?? {}),
			...(useInstructions && thinkingOpts?.openai
				? {
						openai: {
							instructions: systemPrompt,
							store: false,
							...(thinkingOpts.openai as object),
						},
					}
				: {}),
		};

		const streamOpts: StreamTextOptions = {
			model,
			messages: turnMessages,
			tools: toolSet,
			stopWhen: stepCountIs(MAX_STEPS),
			onStepFinish: (step: StepResult<ToolSet>) => {
				logApiEvent("step finish", {
					stepNumber: stepCount + 1,
					finishReason: step.finishReason,
					usage: step.usage,
				});
				inputTokens += step.usage?.inputTokens ?? 0;
				outputTokens += step.usage?.outputTokens ?? 0;
				contextTokens = step.usage?.inputTokens ?? contextTokens;
				stepCount++;

				// Accumulate messages from each step finish.
				// AI SDK's step.response.messages (or step.messages in newer versions)
				// contains the authoritative, deduplicated list of all messages
				// generated across all steps.
				const s = step as unknown as {
					response?: { messages?: CoreMessage[] };
					messages?: CoreMessage[];
				};
				partialState.messages =
					s.response?.messages ?? s.messages ?? partialState.messages;
			},
			// On the last allowed step, strip all tools so the model is forced to
			// respond with text — no more tool calls are possible.
			prepareStep: ({ stepNumber }: { stepNumber: number }) => {
				if (stepNumber >= MAX_STEPS - 1) {
					return { activeTools: [] as Array<keyof typeof toolSet> };
				}
				return undefined;
			},

			...(systemPrompt && !useInstructions ? { system: systemPrompt } : {}),
			...(Object.keys(mergedProviderOptions).length > 0
				? { providerOptions: mergedProviderOptions }
				: {}),
			...(signal ? { abortSignal: signal } : {}),
			experimental_repairToolCall: async ({ toolCall }) => {
				// To avoid 400 Bad Request from the API when it receives malformed JSON
				// in the assistant's tool_calls history, we repair it to a minimal valid JSON.
				// This allows the framework to parse it, fail schema validation gracefully,
				// and send a proper validation error back to the model without crashing the step loop.
				return { ...toolCall, args: "{}" };
			},
		};

		const result = streamText(streamOpts) as StreamTextResultFull;
		// If the stream is aborted, result.response will reject with an AbortError.
		// If the for-await loop breaks early or throws, result.response is never
		// awaited, causing an unhandled rejection that crashes the app.
		// We catch it here to mark it as handled (awaiting it later will still throw).
		result.response.catch(() => {});

		// Stream events
		for await (const chunk of result.fullStream) {
			const c = chunk as StreamChunk;

			if (
				c.type !== "text-delta" &&
				c.type !== "reasoning" &&
				c.type !== "reasoning-delta"
			) {
				logApiEvent("stream chunk", {
					type: c.type,
					toolCallId: c.toolCallId,
					toolName: c.toolName,
					isError: c.isError,
					// Truncate args/output to avoid massive logs if desired, but for now log it all to debug hangups
					hasArgs: "args" in c || "input" in c,
					hasOutput: "output" in c || "result" in c,
				});
			}

			switch (c.type) {
				case "text-delta": {
					// AI SDK v6: property is `text`, not `textDelta`
					const delta =
						typeof c.text === "string"
							? c.text
							: typeof c.textDelta === "string"
								? c.textDelta
								: "";
					yield {
						type: "text-delta",
						delta,
					};
					break;
				}
				case "reasoning-delta":
				case "reasoning": {
					const delta = getReasoningDeltaFromStreamChunk(c);
					if (delta === null) break;
					yield {
						type: "reasoning-delta",
						delta,
					};
					break;
				}

				case "tool-call": {
					yield {
						type: "tool-call-start",
						toolCallId: String(c.toolCallId ?? ""),
						toolName: String(c.toolName ?? ""),
						// AI SDK v6: property is `input`, not `args`
						args: c.input ?? c.args,
					};
					break;
				}

				case "tool-result": {
					yield {
						type: "tool-result",
						toolCallId: String(c.toolCallId ?? ""),
						toolName: String(c.toolName ?? ""),
						// AI SDK v6: property is `output`, not `result`
						result:
							"output" in c ? c.output : "result" in c ? c.result : undefined,
						isError: "isError" in c ? Boolean(c.isError) : false,
					};
					break;
				}

				case "tool-error":
					yield {
						type: "tool-result",
						toolCallId: String(c.toolCallId ?? ""),
						toolName: String(c.toolName ?? ""),
						result: c.error ?? "Tool execution failed",
						isError: true,
					};
					break;

				case "error": {
					const err = c.error;
					throw err instanceof Error ? err : new Error(String(err));
				}
			}
		}

		// We use finalMessages accumulated from onStepFinish instead of awaiting result.response.
		// Awaiting result.response causes the process to hang indefinitely for Anthropic models in Bun
		// due to a known bug in @ai-sdk/anthropic's tee() stream usage.
		// Since step.response.messages includes the full deduplicated list, the last invocation
		// gives us the exact equivalent without waiting on the broken promise.
		const newMessages = partialState.messages;

		logApiEvent("turn complete", {
			newMessagesCount: newMessages.length,
			inputTokens,
			outputTokens,
		});

		yield {
			type: "turn-complete",
			inputTokens,
			outputTokens,
			contextTokens,
			// Pass raw ModelMessage objects — no conversion; they are fed back to
			// streamText on the next turn and must stay in their original shape.
			messages: newMessages,
		};
	} catch (err) {
		logApiEvent("turn error", err);
		yield {
			type: "turn-error",
			error: err instanceof Error ? err : new Error(String(err)),
			partialMessages: partialState.messages,
		};
	}
}
