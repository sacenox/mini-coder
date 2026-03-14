import * as c from "yoctocolors";
import { buildAbortMessages, isAbortError } from "../agent/agent-helpers.ts";
import type { CoreMessage } from "../llm-api/turn.ts";
import type { TurnEvent } from "../llm-api/types.ts";
import { renderLine } from "./markdown.ts";
import { G, RenderedError, renderError, write, writeln } from "./output.ts";
import {
	normalizeReasoningDelta,
	normalizeReasoningText,
} from "./reasoning.ts";
import type { Spinner } from "./spinner.ts";
import {
	buildClearPartialPreview,
	createPartialPreviewTracker,
	resetPartialPreviewTracker,
	setStreamPreviewPrefix,
	streamPartialPreviewDelta,
} from "./stream-preview.ts";
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
	// Prefix prepended when overwriting the raw partial with the styled complete
	// line. For text replies: "◆ " (renderSingleLine output doesn't include it).
	// For reasoning: "" (renderSingleLine already includes "│ " in its output).
	let styledPrefix = "";
	const partialPreview = createPartialPreviewTracker();
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

	// Reset per-line partial-preview tracking. styledPrefix is intentionally
	// excluded — it is turn-level state (◆ for text, "" for reasoning) and must
	// persist across lines within the same turn.
	function resetLineState(): void {
		resetPartialPreviewTracker(partialPreview);
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
			if (partialPreview.partialWritten > 0) {
				// Raw partial content is on the terminal — clear wrapped rows and
				// replace it with the properly styled version.
				const clearSeq = buildClearPartialPreview(
					partialPreview,
					process.stdout.columns ?? 0,
				);
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
			if (firstLine && partialPreview.partialWritten > 0) {
				const clearSeq = buildClearPartialPreview(
					partialPreview,
					process.stdout.columns ?? 0,
				);
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
		const out = streamPartialPreviewDelta(partialPreview, rawBuffer);
		if (!out) return;
		spinner.stop();
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
					setStreamPreviewPrefix(partialPreview, `${G.reply} `, true);
					styledPrefix = `${G.reply} `;
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
					setStreamPreviewPrefix(partialPreview, "  ", false);
					styledPrefix = "";
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
				if (isAbortError(event.error)) {
					newMessages = buildAbortMessages(
						event.partialMessages,
						accumulatedText,
					);
				} else {
					renderError(event.error, "turn");
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
