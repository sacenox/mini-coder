import * as c from "yoctocolors";
import type { CoreMessage } from "../llm-api/turn.ts";
import type { TurnEvent } from "../llm-api/types.ts";
import { logError } from "./error-log.ts";
import { parseAppError } from "./error-parse.ts";
import { renderChunk } from "./markdown.ts";
import { G, writeln } from "./output.ts";
import type { Spinner } from "./spinner.ts";
import { renderToolCall, renderToolResult } from "./tool-render.ts";

export async function renderTurn(
	events: AsyncIterable<TurnEvent>,
	spinner: Spinner,
): Promise<{
	inputTokens: number;
	outputTokens: number;
	contextTokens: number;
	newMessages: CoreMessage[];
}> {
	let inText = false;
	let rawBuffer = "";
	let inFence = false;
	let printQueue = "";
	let printPos = 0;
	let tickerHandle: ReturnType<typeof setTimeout> | null = null;

	let inputTokens = 0;
	let outputTokens = 0;
	let contextTokens = 0;
	let newMessages: CoreMessage[] = [];

	function enqueuePrint(ansi: string): void {
		printQueue += ansi;
		if (tickerHandle === null) {
			scheduleTick();
		}
	}

	function tick(): void {
		tickerHandle = null;
		if (printPos < printQueue.length) {
			process.stdout.write(printQueue[printPos] as string);
			printPos++;
			scheduleTick();
		} else {
			printQueue = "";
			printPos = 0;
		}
	}

	function scheduleTick(): void {
		tickerHandle = setTimeout(tick, 8);
	}

	function drainQueue(): void {
		if (tickerHandle !== null) {
			clearTimeout(tickerHandle);
			tickerHandle = null;
		}
		if (printPos < printQueue.length) {
			process.stdout.write(printQueue.slice(printPos));
		}
		printQueue = "";
		printPos = 0;
	}

	function renderAndTrim(end: number): void {
		const chunk = rawBuffer.slice(0, end);
		const rendered = renderChunk(chunk, inFence);
		inFence = rendered.inFence;
		enqueuePrint(rendered.output);
		rawBuffer = rawBuffer.slice(end);
	}

	function flushChunks(): void {
		let boundary = rawBuffer.indexOf("\n\n");
		if (boundary !== -1) {
			renderAndTrim(boundary + 2);
			flushChunks();
			return;
		}
		boundary = rawBuffer.lastIndexOf("\n");
		if (boundary !== -1) {
			renderAndTrim(boundary + 1);
		}
	}

	function flushAll(): void {
		if (rawBuffer) {
			renderAndTrim(rawBuffer.length);
		}
		drainQueue();
	}

	for await (const event of events) {
		switch (event.type) {
			case "text-delta": {
				if (!inText) {
					spinner.stop();
					process.stdout.write(`${G.reply} `);
					inText = true;
				}
				rawBuffer += event.delta;
				flushChunks();
				break;
			}

			case "tool-call-start": {
				if (inText) {
					flushAll();
					writeln();
					inText = false;
				}
				spinner.stop();
				renderToolCall(event.toolName, event.args);
				spinner.start(event.toolName);
				break;
			}

			case "tool-result": {
				spinner.stop();
				renderToolResult(event.toolName, event.result, event.isError);
				spinner.start("thinking");
				break;
			}

			case "turn-complete": {
				if (inText) {
					flushAll();
					writeln();
					inText = false;
				}
				spinner.stop();
				inputTokens = event.inputTokens;
				outputTokens = event.outputTokens;
				contextTokens = event.contextTokens;
				newMessages = event.messages;
				break;
			}

			case "turn-error": {
				if (inText) {
					flushAll();
					writeln();
					inText = false;
				}
				spinner.stop();
				const isAbort =
					event.error.name === "AbortError" ||
					(event.error.name === "Error" &&
						event.error.message.toLowerCase().includes("abort"));
				if (isAbort) {
					writeln(`${G.warn} ${c.dim("interrupted")}`);
				} else {
					logError(event.error, "turn");
					const parsed = parseAppError(event.error);
					writeln(`${G.err} ${c.red(parsed.headline)}`);
					if (parsed.hint) {
						writeln(`  ${c.dim(parsed.hint)}`);
					}
				}
				break;
			}
		}
	}

	return { inputTokens, outputTokens, contextTokens, newMessages };
}
