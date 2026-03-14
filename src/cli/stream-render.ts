import * as c from "yoctocolors";
import { buildAbortMessages, isAbortError } from "../agent/agent-helpers.ts";
import type { CoreMessage } from "../llm-api/turn.ts";
import type { TurnEvent } from "../llm-api/types.ts";
import { logError } from "./error-log.ts";
import { parseAppError } from "./error-parse.ts";
import { renderLine } from "./markdown.ts";
import { G, write, writeln } from "./output.ts";
import {
	normalizeReasoningDelta,
	normalizeReasoningText,
} from "./reasoning.ts";
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
	let reasoningBlankLineRun = 0;

	let inputTokens = 0;
	let outputTokens = 0;
	let contextTokens = 0;
	let newMessages: CoreMessage[] = [];

	/**
	 * Render a single raw line, updating shared fence/blank-run state.
	 * Returns the rendered string, or null if the line should be suppressed
	 * (e.g. a second consecutive blank line inside a reasoning block).
	 */
	function renderSingleLine(raw: string): string | null {
		const source = inReasoning ? raw.replace(/[ \t]+$/g, "") : raw;
		if (inReasoning && source.trim() === "") {
			reasoningBlankLineRun += 1;
			if (reasoningBlankLineRun > 1) return null;
		} else if (inReasoning) {
			reasoningBlankLineRun = 0;
		}

		const rendered = renderLine(source, inFence);
		inFence = rendered.inFence;
		return inReasoning ? `${c.dim("│ ")}${rendered.output}` : rendered.output;
	}

	function renderAndWrite(raw: string, endWithNewline: boolean): void {
		// Defensive stop: some providers stream tiny chunks and spinner ticks can
		// interleave with stdout writes unless we stop right before each render.
		spinner.stop();

		const out = renderSingleLine(raw);
		if (out === null) return;
		write(out);
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
			reasoningBlankLineRun = 0;
		}
	}

	function flushCompleteLines(): void {
		// Use an index cursor instead of repeatedly slicing rawBuffer after each
		// line — the original `rawBuffer = rawBuffer.slice(boundary + 1)` pattern
		// is O(n²) for large blocks because it copies all remaining content on
		// every iteration.  We do a single slice at the end instead.
		// All rendered lines are also batched into one write() call to avoid the
		// overhead of thousands of individual stdout syscalls.
		let start = 0;
		let boundary = rawBuffer.indexOf("\n", start);
		if (boundary === -1) return;

		spinner.stop();
		let batchOutput = "";

		while (boundary !== -1) {
			const raw = rawBuffer.slice(start, boundary);
			start = boundary + 1;
			boundary = rawBuffer.indexOf("\n", start);

			const out = renderSingleLine(raw);
			if (out !== null) batchOutput += `${out}\n`;
		}

		rawBuffer = start > 0 ? rawBuffer.slice(start) : rawBuffer;
		if (batchOutput) write(batchOutput);
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
				const delta = normalizeReasoningDelta(event.delta);
				accumulatedReasoning += delta;
				if (!showReasoning) {
					break;
				}
				if (!inReasoning) {
					if (inText) {
						flushAnyText();
					}
					spinner.stop();
					writeln(`${G.info} ${c.dim("reasoning")}`);
					inReasoning = true;
				}
				rawBuffer += delta;
				flushCompleteLines();
				break;
			}

			case "tool-call-start": {
				flushAnyText();
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

			case "context-pruned": {
				flushAnyText();
				spinner.stop();
				writeln(
					`${G.info} ${c.dim(`context-pruned mode=${event.mode} removed_messages=${event.removedMessageCount} removed_bytes=${event.removedBytes} messages_before=${event.beforeMessageCount} messages_after=${event.afterMessageCount}`)}`,
				);
				break;
			}

			case "turn-complete": {
				const hadContent = inText || inReasoning;
				flushAnyText();
				spinner.stop();
				if (!hadContent) writeln();
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
		reasoningText: normalizeReasoningText(accumulatedReasoning),
	};
}
