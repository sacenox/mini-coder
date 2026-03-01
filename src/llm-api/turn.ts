import { dynamicTool, jsonSchema, stepCountIs, streamText } from "ai";
import type { FlexibleSchema, StepResult } from "ai";
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

function toCoreTool(
	def: ToolDef,
	claimWarning: () => boolean,
): ReturnType<typeof dynamicTool> {
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
				const result = await def.execute(input);
				// On the second-to-last step, append a system message to the first
				// tool result that completes. claimWarning() returns true exactly once
				// per step so parallel tool calls don't duplicate the warning.
				if (claimWarning()) {
					const warning =
						"\n\n<system-message>You have reached the maximum number of tool calls. " +
						"No more tools will be available after this result. " +
						"Respond with a status update and list what still needs to be done.</system-message>";
					const str =
						typeof result === "string" ? result : JSON.stringify(result);
					return str + warning;
				}
				return result;
			} catch (err) {
				throw err instanceof Error ? err : new Error(String(err));
			}
		},
	});
}

// ─── Main turn function ───────────────────────────────────────────────────────

/**
 * Returns true when the model string refers to an OpenAI GPT model, which uses
 * the Responses API and honours the `instructions` provider option as the
 * authoritative system prompt (rather than a system-role message in `input`).
 */
function isOpenAIGPT(modelString: string): boolean {
	const slashIdx = modelString.indexOf("/");
	const provider =
		slashIdx === -1 ? modelString : modelString.slice(0, slashIdx);
	const modelId = slashIdx === -1 ? "" : modelString.slice(slashIdx + 1);
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
}): AsyncGenerator<TurnEvent> {
	const { model, modelString, messages, tools, systemPrompt, signal } = options;

	// stepCount tracks completed steps (incremented in onStepFinish).
	// Used to detect the second-to-last step for the warning injection.
	let stepCount = 0;
	// warningClaimed resets to false at the start of each step and is flipped to
	// true by the first tool that completes on the second-to-last step, ensuring
	// the <system-message> warning appears exactly once even with parallel calls.
	let warningClaimed = false;

	// Returns true exactly once on the second-to-last step, so parallel tool
	// calls in the same step only inject the <system-message> warning once.
	function claimWarning(): boolean {
		if (stepCount !== MAX_STEPS - 2 || warningClaimed) return false;
		warningClaimed = true;
		return true;
	}

	const toolSet = {} as ToolSet;
	for (const def of tools) {
		(toolSet as Record<string, ToolEntry>)[def.name] = toCoreTool(
			def,
			claimWarning,
		);
	}

	let inputTokens = 0;
	let outputTokens = 0;
	// Overwritten each step — after all steps this holds the last step's input
	// token count, which approximates context window usage (each step re-sends
	// the full conversation history, so later steps have larger prompts).
	let contextTokens = 0;

	try {
		// OpenAI GPT models use the Responses API (@ai-sdk/openai v3 / ai v6 default),
		// which honours `instructions` as the authoritative system prompt. Passing it
		// as a system-role message in `input` works but is treated as a lower-priority
		// user turn, causing the model to deprioritise the instructions.
		const useInstructions =
			systemPrompt !== undefined &&
			modelString !== undefined &&
			isOpenAIGPT(modelString);

		// GPT models tend to describe planned tool calls without making them, then
		// yield back to the user. This applies broadly across the gpt-* family.
		// The one-liner closes that gap without adding opinion about how to do the task.
		const GPT_CONTINUATION =
			"\n\nAlways make tool calls rather than describing them. Keep going until the task is complete, then stop.";

		const streamOpts: StreamTextOptions = {
			model,
			messages,
			tools: toolSet,
			stopWhen: stepCountIs(MAX_STEPS),
			onStepFinish: (step: StepResult<ToolSet>) => {
				inputTokens += step.usage?.inputTokens ?? 0;
				outputTokens += step.usage?.outputTokens ?? 0;
				contextTokens = step.usage?.inputTokens ?? contextTokens;
				stepCount++;
				warningClaimed = false;
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
			...(useInstructions
				? {
						providerOptions: {
							openai: {
								instructions: systemPrompt + GPT_CONTINUATION,
								store: false,
							},
						},
					}
				: {}),
			...(signal ? { abortSignal: signal } : {}),
		};

		const result = streamText(streamOpts) as StreamTextResultFull;
		// If the stream is aborted, result.response will reject with an AbortError.
		// If the for-await loop breaks early or throws, result.response is never
		// awaited, causing an unhandled rejection that crashes the app.
		// We catch it here to mark it as handled (awaiting it later will still throw).
		result.response.catch(() => {});

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

export { z };
