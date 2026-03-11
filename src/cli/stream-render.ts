import * as c from "yoctocolors";
import { buildAbortMessages, isAbortError } from "../agent/agent-helpers.ts";
import type { CoreMessage } from "../llm-api/turn.ts";
import type { TurnEvent } from "../llm-api/types.ts";
import { logError } from "./error-log.ts";
import { parseAppError } from "./error-parse.ts";
import { renderLine } from "./markdown.ts";
import { G, write, writeln } from "./output.ts";
import type { Spinner } from "./spinner.ts";
import { renderToolCall, renderToolResult } from "./tool-render.ts";

export async function renderTurn(
	events: AsyncIterable<TurnEvent>,
	spinner: Spinner,
	opts?: { showReasoning?: boolean },
): Promise<{
	inputTokens: number;
	outputTokens: number;
	contextTokens: number;
	newMessages: CoreMessage[];
	reasoningText: string;
}> {
	const showReasoning = opts?.showReasoning ?? true;
	let inText = false;
	let inReasoning = false;
	let rawBuffer = "";
	let accumulatedText = "";
	let accumulatedReasoning = "";

	let inFence = false;

	let inputTokens = 0;
	let outputTokens = 0;
	let contextTokens = 0;
	let newMessages: CoreMessage[] = [];

	function renderAndWrite(raw: string, endWithNewline: boolean): void {
		// Defensive stop: some providers stream tiny chunks and spinner ticks can
		// interleave with stdout writes unless we stop right before each render.
		spinner.stop();
		const rendered = renderLine(raw, inFence);
		inFence = rendered.inFence;
		const finalOutput = inReasoning ? c.dim(rendered.output) : rendered.output;
		write(finalOutput);
		if (endWithNewline) {
			write("\n");
		}
	}

	function flushAnyText(): void {
		if (inText || inReasoning) {
			flushAll();
			writeln();
			inText = false;
			inReasoning = false;
		}
	}

	function flushCompleteLines(): void {
		let boundary = rawBuffer.indexOf("\n");
		while (boundary !== -1) {
			renderAndWrite(rawBuffer.slice(0, boundary), true);
			rawBuffer = rawBuffer.slice(boundary + 1);
			boundary = rawBuffer.indexOf("\n");
		}
	}

	function flushAll(): void {
		if (!rawBuffer) {
			return;
		}
		renderAndWrite(rawBuffer, false);
		rawBuffer = "";
	}

	for await (const event of events) {
		switch (event.type) {
			case "text-delta": {
				if (inReasoning) {
					flushAnyText();
				}
				if (!inText) {
					spinner.stop();
					write(`${G.reply} `);
					inText = true;
				}
				rawBuffer += event.delta;
				accumulatedText += event.delta;

				flushCompleteLines();
				break;
			}
			case "reasoning-delta": {
				accumulatedReasoning += event.delta;
				if (!showReasoning) {
					break;
				}
				if (!inReasoning) {
					if (inText) {
						flushAnyText();
					}
					spinner.stop();
					write(`${c.dim("Thinking...")}\n`);
					inReasoning = true;
				}
				rawBuffer += event.delta;
				flushCompleteLines();
				break;
			}

			case "tool-call-start": {
				flushAnyText();
				spinner.stop();
				renderToolCall(event.toolName, event.args, event.toolCallId);
				spinner.start(event.toolName);
				break;
			}

			case "tool-result": {
				spinner.stop();
				renderToolResult(
					event.toolName,
					event.result,
					event.isError,
					event.toolCallId,
				);
				spinner.start("thinking");
				break;
			}

			case "turn-complete": {
				flushAnyText();
				spinner.stop();
				inputTokens = event.inputTokens;
				outputTokens = event.outputTokens;
				contextTokens = event.contextTokens;
				newMessages = event.messages;
				break;
			}

			case "turn-error": {
				flushAnyText();
				spinner.stop();
				const isAbort = isAbortError(event.error);
				if (isAbort) {
					newMessages = buildAbortMessages(
						event.partialMessages,
						accumulatedText,
					);
				} else {
					logError(event.error, "turn");
					const parsed = parseAppError(event.error);
					writeln(`${G.err} ${c.red(parsed.headline)}`);
					if (parsed.hint) {
						writeln(`  ${c.dim(parsed.hint)}`);
					}
					throw event.error;
				}
				break;
			}
		}
	}

	return {
		inputTokens,
		outputTokens,
		contextTokens,
		newMessages,
		reasoningText: accumulatedReasoning,
	};
}
