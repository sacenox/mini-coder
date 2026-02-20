import { dynamicTool, jsonSchema, stepCountIs, streamText } from "ai";
import type { StepResult } from "ai";
import { z } from "zod";
import type { ToolDef, TurnEvent } from "./types.ts";

type StreamTextOptions = Parameters<typeof streamText>[0];
export type CoreMessage = NonNullable<StreamTextOptions["messages"]>[number];
type CoreModel = StreamTextOptions["model"];
type ToolSet = NonNullable<StreamTextOptions["tools"]>;
type ToolEntry = ToolSet extends Record<string, infer T> ? T : never;
type StreamChunk = { type?: string; [key: string]: unknown };

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
		? (def.schema as import("ai").FlexibleSchema<unknown>)
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

// ─── Main turn function ───────────────────────────────────────────────────────

/**
 * Run a single agent turn against the model.
 *
 * Yields TurnEvents as they arrive, then yields a final TurnCompleteEvent
 * (or TurnErrorEvent on failure).
 */
export async function* runTurn(options: {
	model: CoreModel;
	messages: CoreMessage[];
	tools: ToolDef[];
	systemPrompt?: string;
	signal?: AbortSignal;
}): AsyncGenerator<TurnEvent> {
	const { model, messages, tools, systemPrompt, signal } = options;

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

	try {
		const streamOpts: StreamTextOptions = {
			model,
			messages,
			tools: toolSet,
			stopWhen: stepCountIs(MAX_STEPS),
			onStepFinish: (step: StepResult<ToolSet>) => {
				inputTokens += step.usage?.inputTokens ?? 0;
				outputTokens += step.usage?.outputTokens ?? 0;
				contextTokens = step.usage?.inputTokens ?? contextTokens;
			},
			...(systemPrompt ? { system: systemPrompt } : {}),
			...(signal ? { abortSignal: signal } : {}),
		};

		const result = streamText(streamOpts) as StreamTextResultFull;

		// Stream events
		for await (const chunk of result.fullStream) {
			if (signal?.aborted) break;

			const c = chunk as StreamChunk;

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
						isError: false,
					};
					break;
				}

				case "tool-error": {
					yield {
						type: "tool-result",
						toolCallId: String(c.toolCallId ?? ""),
						toolName: String(c.toolName ?? ""),
						result: c.error ?? "Tool execution failed",
						isError: true,
					};
					break;
				}

				case "error": {
					const err = c.error;
					throw err instanceof Error ? err : new Error(String(err));
				}
			}
		}

		// Collect the final response messages after the stream completes.
		// Using result.response (which resolves to the final step's response)
		// gives us the authoritative, deduplicated list of all messages generated
		// across all steps. Accumulating from onStepFinish would cause duplicates
		// because step.response.messages includes all prior step messages PLUS the
		// current step's messages on each callback invocation.
		const finalResponse = await result.response;
		const newMessages = finalResponse?.messages ?? [];

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
		yield {
			type: "turn-error",
			error: err instanceof Error ? err : new Error(String(err)),
		};
	}
}

// ─── Message builder helpers ──────────────────────────────────────────────────

export function userMessage(text: string): CoreMessage {
	return { role: "user", content: text };
}

export { z };
