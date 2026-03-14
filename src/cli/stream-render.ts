import * as c from "yoctocolors";
import { buildAbortMessages, isAbortError } from "../agent/agent-helpers.ts";
import type { CoreMessage } from "../llm-api/turn.ts";
import type { TurnEvent } from "../llm-api/types.ts";
import { logError } from "./error-log.ts";
import { parseAppError } from "./error-parse.ts";
import { RenderedError } from "./error-render.ts";

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

		const rendered = renderLine(source, inFence);
		inFence = rendered.inFence;
		return inReasoning ? `${c.dim("│ ")}${rendered.output}` : rendered.output;
	}

	const emojiLikeRegex = /\p{Extended_Pictographic}/u;
	const ansiEscapeChar = String.fromCharCode(0x1b);
	const graphemeSegmenter =
		typeof Intl !== "undefined" && typeof Intl.Segmenter === "function"
			? new Intl.Segmenter(undefined, { granularity: "grapheme" })
			: null;

	function stripSgrAnsi(s: string): string {
		if (!s) return "";
		let out = "";
		for (let i = 0; i < s.length; i++) {
			if (s[i] !== ansiEscapeChar || s[i + 1] !== "[") {
				out += s[i] ?? "";
				continue;
			}

			let j = i + 2;
			while (j < s.length) {
				const ch = s[j] ?? "";
				if ((ch >= "0" && ch <= "9") || ch === ";") {
					j++;
					continue;
				}
				break;
			}

			if (s[j] === "m") {
				i = j;
				continue;
			}

			out += s[i] ?? "";
		}
		return out;
	}

	function isControlCodePoint(cp: number): boolean {
		return (cp >= 0 && cp <= 0x1f) || (cp >= 0x7f && cp <= 0x9f);
	}

	function isCombiningCodePoint(cp: number): boolean {
		return (
			(cp >= 0x0300 && cp <= 0x036f) ||
			(cp >= 0x1ab0 && cp <= 0x1aff) ||
			(cp >= 0x1dc0 && cp <= 0x1dff) ||
			(cp >= 0x20d0 && cp <= 0x20ff) ||
			(cp >= 0xfe20 && cp <= 0xfe2f)
		);
	}

	function isVariationSelector(cp: number): boolean {
		return (cp >= 0xfe00 && cp <= 0xfe0f) || (cp >= 0xe0100 && cp <= 0xe01ef);
	}

	function isWideCodePoint(cp: number): boolean {
		return (
			cp >= 0x1100 &&
			(cp <= 0x115f ||
				cp === 0x2329 ||
				cp === 0x232a ||
				(cp >= 0x2e80 && cp <= 0xa4cf && cp !== 0x303f) ||
				(cp >= 0xac00 && cp <= 0xd7a3) ||
				(cp >= 0xf900 && cp <= 0xfaff) ||
				(cp >= 0xfe10 && cp <= 0xfe19) ||
				(cp >= 0xfe30 && cp <= 0xfe6f) ||
				(cp >= 0xff00 && cp <= 0xff60) ||
				(cp >= 0xffe0 && cp <= 0xffe6) ||
				(cp >= 0x1f300 && cp <= 0x1f64f) ||
				(cp >= 0x1f900 && cp <= 0x1f9ff) ||
				(cp >= 0x20000 && cp <= 0x3fffd))
		);
	}

	function graphemeWidth(grapheme: string): number {
		if (!grapheme) return 0;
		if (emojiLikeRegex.test(grapheme)) return 2;

		let width = 0;
		let hasRegionalIndicator = false;
		for (const ch of grapheme) {
			const cp = ch.codePointAt(0);
			if (cp === undefined) continue;
			if (cp >= 0x1f1e6 && cp <= 0x1f1ff) hasRegionalIndicator = true;
			if (
				isControlCodePoint(cp) ||
				isCombiningCodePoint(cp) ||
				isVariationSelector(cp) ||
				cp === 0x200d ||
				(cp >= 0x1f3fb && cp <= 0x1f3ff)
			) {
				continue;
			}
			width += isWideCodePoint(cp) ? 2 : 1;
		}

		if (hasRegionalIndicator) return 2;
		return width;
	}

	function visibleLength(s: string): number {
		if (!s) return 0;
		const plain = stripSgrAnsi(s);
		if (!plain) return 0;

		if (!graphemeSegmenter) {
			let width = 0;
			for (const ch of plain) {
				const cp = ch.codePointAt(0);
				if (cp === undefined || isControlCodePoint(cp)) continue;
				width += isWideCodePoint(cp) ? 2 : 1;
			}
			return width;
		}

		let width = 0;
		for (const { segment } of graphemeSegmenter.segment(plain)) {
			width += graphemeWidth(segment);
		}
		return width;
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
					// streamPrefix is written by streamPartialLine before the first
					// chars of each line to show the "│ " gutter in the raw preview.
					// styledPrefix is empty because renderSingleLine already includes
					// "│ " in its output for reasoning lines.
					streamPrefix = c.dim("│ ");
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
