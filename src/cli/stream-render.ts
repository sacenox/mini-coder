import * as c from "yoctocolors";
import { buildAbortMessages, isAbortError } from "../agent/agent-helpers.ts";
import type { CoreMessage } from "../llm-api/turn.ts";
import type { TurnEvent } from "../llm-api/types.ts";
import { logError } from "./error-log.ts";
import { parseAppError } from "./error-parse.ts";
import { RenderedError } from "./output.ts";

import { renderLine } from "./markdown.ts";
import { G, write, writeln } from "./output.ts";
import {
	normalizeReasoningDelta,
	normalizeReasoningText,
} from "./reasoning.ts";
import type { Spinner } from "./spinner.ts";
import { visibleLength } from "./terminal-width.ts";
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
	// rawBuffer holds the current incomplete (no trailing \n) line being built.
	let rawBuffer = "";
	// How many characters of rawBuffer have already been written to the terminal
	// as a raw partial line (before markdown rendering). When a newline arrives
	// the partial is overwritten with the properly styled complete line.
	let partialWritten = 0;
	// Approximate visible character count shown for the streamed partial preview
	// (including any streamed prefix). Used to clear wrapped terminal rows.
	let partialVisibleChars = 0;
	// Prefix shown before raw partial content during streaming previews.
	// For text replies: "◆ " (already written before streaming starts, so
	// streamPartialLine skips it). For reasoning: "│ " (written by
	// streamPartialLine since renderSingleLine doesn't emit a separate write).
	let streamPrefix = "";
	// Whether streamPrefix has already been written to the terminal.
	// True for text replies; false for reasoning (streamPartialLine emits it).
	let streamPrefixWritten = false;
	// Prefix prepended when overwriting the raw partial with the styled complete
	// line. For text replies: "◆ " (renderSingleLine output doesn't include it).
	// For reasoning: "" (renderSingleLine already includes "│ " in its output).
	let styledPrefix = "";
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

		if (inReasoning) {
			return `  ${c.dim(c.italic(source))}`;
		}
		const rendered = renderLine(source, inFence);
		inFence = rendered.inFence;
		return rendered.output;
	}

	function estimateWrappedRows(visibleChars: number): number {
		if (visibleChars <= 0) return 1;
		const cols = process.stdout.columns ?? 0;
		if (cols <= 0) return 1;
		return Math.max(1, Math.ceil(visibleChars / cols));
	}

	function clearPartialPreview(): string {
		if (partialWritten <= 0) return "";
		const rows = estimateWrappedRows(partialVisibleChars);
		let seq = "\r\x1b[2K";
		for (let i = 1; i < rows; i++) {
			seq += "\x1b[1A\r\x1b[2K";
		}
		return seq;
	}

	// Reset per-line partial-preview tracking. styledPrefix is intentionally
	// excluded — it is turn-level state (◆ for text, "" for reasoning) and must
	// persist across lines within the same turn.
	function resetLineState(): void {
		partialWritten = 0;
		partialVisibleChars = 0;
		streamPrefix = "";
		streamPrefixWritten = false;
	}

	/**
	 * Flush the trailing partial line (rawBuffer) and write a newline.
	 * If a partial-line preview was already written to the terminal, overwrite
	 * it with the properly markdown-rendered version first.
	 */
	function flushAnyText(): void {
		if (!inText && !inReasoning) return;

		if (rawBuffer) {
			spinner.stop();
			const out = renderSingleLine(rawBuffer);
			rawBuffer = "";
			if (partialWritten > 0) {
				// Raw partial content is on the terminal — clear wrapped rows and
				// replace it with the properly styled version.
				const clearSeq = clearPartialPreview();
				if (out !== null) write(`${clearSeq}${styledPrefix}${out}`);
				else write(clearSeq);
			} else {
				if (out !== null) write(out);
			}
		}
		writeln();
		inText = false;
		inReasoning = false;
		inFence = false; // reasoning is never markdown; reset fence state at boundary
		reasoningBlankLineRun = 0;
		styledPrefix = "";
		resetLineState();
	}

	/**
	 * Process rawBuffer: render and output all complete (newline-terminated)
	 * lines; leave any trailing partial in rawBuffer.
	 * If a partial-line preview was already written, the first complete line
	 * clears it before writing styled content.
	 */
	function flushCompleteLines(): void {
		// Use an index cursor instead of repeatedly slicing rawBuffer after each
		// line — O(n) single scan, single slice at the end.
		let start = 0;
		let boundary = rawBuffer.indexOf("\n", start);
		if (boundary === -1) return;

		spinner.stop();
		let batchOutput = "";
		let firstLine = true;

		while (boundary !== -1) {
			const raw = rawBuffer.slice(start, boundary);
			start = boundary + 1;
			boundary = rawBuffer.indexOf("\n", start);

			const out = renderSingleLine(raw);
			// If raw partial content was already streamed to the terminal, clear it
			// and replace with the properly styled complete-line render.
			if (firstLine && partialWritten > 0) {
				const clearSeq = clearPartialPreview();
				if (out !== null) batchOutput += `${clearSeq}${styledPrefix}${out}\n`;
				else batchOutput += `${clearSeq}\n`;
			} else if (out !== null) {
				batchOutput += `${out}\n`;
			}
			firstLine = false;
		}

		rawBuffer = start > 0 ? rawBuffer.slice(start) : rawBuffer;
		// rawBuffer now holds a fresh partial line. Reset per-line tracking.
		// styledPrefix is also cleared: the reply glyph only prefixes the first
		// line of a turn; continuation lines have no prefix.
		styledPrefix = "";
		resetLineState();
		if (batchOutput) write(batchOutput);
	}

	/**
	 * Write any new characters in rawBuffer that haven't been streamed yet,
	 * giving the user immediate visual feedback before the line is complete.
	 * Emits streamPrefix before the first characters of each new line when
	 * it hasn't been written yet (e.g. "│ " gutter for reasoning).
	 */
	function streamPartialLine(): void {
		if (rawBuffer.length <= partialWritten) return;
		spinner.stop();
		let out = "";
		if (!streamPrefixWritten && streamPrefix) {
			out += streamPrefix;
			streamPrefixWritten = true;
			partialVisibleChars += visibleLength(streamPrefix);
		}
		const delta = rawBuffer.slice(partialWritten);
		out += delta;
		partialVisibleChars += visibleLength(delta);
		partialWritten = rawBuffer.length;
		write(out);
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
					// "◆ " is already on the terminal. Record it for overwrite
					// restoration and count it toward wrapped-row clearing.
					streamPrefix = `${G.reply} `;
					styledPrefix = `${G.reply} `;
					streamPrefixWritten = true;
					partialVisibleChars += visibleLength(streamPrefix);
					inText = true;
				}
				rawBuffer += event.delta;
				accumulatedText += event.delta;

				flushCompleteLines();
				// Stream any new partial-line content immediately so the user sees
				// output without waiting for the next newline.
				streamPartialLine();
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
					inFence = false; // reasoning is never markdown; reset fence state at boundary
					// streamPrefix provides the 2-space indent for the raw partial
					// preview; renderSingleLine applies the same indent for completed lines.
					streamPrefix = "  ";
					styledPrefix = "";
					streamPrefixWritten = false;
				}
				rawBuffer += delta;
				flushCompleteLines();
				// Stream any new partial-line content immediately.
				streamPartialLine();
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
				const removedKb = (event.removedBytes / 1024).toFixed(1);
				writeln(
					`${G.info} ${c.dim("context pruned")}  ${c.dim(event.mode)}  ${c.dim(`–${event.removedMessageCount} messages`)}  ${c.dim(`–${removedKb} KB`)}`,
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
					throw new RenderedError(event.error);
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
