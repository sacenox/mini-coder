import * as c from "yoctocolors";

import { addPromptHistory, getPromptHistory } from "../session/db/index.ts";
import type { ImageAttachment } from "./image-types.ts";
import {
	buildPromptDisplay,
	createPasteToken,
	expandInputBuffer,
	getVisualCursor,
	pruneInputPasteTokens,
	renderInputBuffer,
} from "./input-buffer.ts";
import { getInputCompletion } from "./input-completion.ts";
import {
	getSubagentControlAction,
	getTurnControlAction,
} from "./input-control.ts";
import {
	deleteWordBackward as deleteWordBackwardInBuffer,
	insertAtCursor,
	moveCursorWordLeft,
	moveCursorWordRight,
} from "./input-editing.ts";
import { tryExtractImageFromPaste } from "./input-images.ts";
import { terminal } from "./terminal-io.ts";

// ─── ANSI escape sequences ────────────────────────────────────────────────────

const ESC = "\x1B";
const CSI = `${ESC}[`;
const CLEAR_LINE = `\r${CSI}2K`;
const BPASTE_ENABLE = `${ESC}[?2004h`;
const BPASTE_DISABLE = `${ESC}[?2004l`;
const BPASTE_START = `${ESC}[200~`;
const BPASTE_END = `${ESC}[201~`;

// ─── Keycodes ─────────────────────────────────────────────────────────────────

const ENTER = "\r";
const NEWLINE = "\n";
const BACKSPACE = "\x7F";
const CTRL_C = "\x03";
const CTRL_D = "\x04";
const CTRL_A = "\x01";
const CTRL_E = "\x05";
const CTRL_W = "\x17";
const CTRL_U = "\x15";
const CTRL_K = "\x0B";
const CTRL_L = "\x0C";
const CTRL_R = "\x12";
const TAB = "\x09";

// ─── Types ────────────────────────────────────────────────────────────────────

export type { ImageAttachment };

export type InputResult =
	| { type: "submit"; text: string; images: ImageAttachment[] }
	| { type: "interrupt" }
	| { type: "eof" }
	| { type: "command"; command: string; args: string }
	| { type: "shell"; command: string };

export {
	buildPromptDisplay,
	expandInputBuffer,
	pasteLabel,
	pruneInputPasteTokens,
	renderInputBuffer,
} from "./input-buffer.ts";
export {
	getSubagentControlAction,
	getTurnControlAction,
} from "./input-control.ts";

// ─── Singleton stdin reader (shared across readline() calls) ─────────────────
// We create the ReadableStream once so that repeated readline() calls don't
// each wrap process.stdin in their own controller, which causes
// "Controller is already closed" on the second invocation.

type StreamReader = {
	read: () => Promise<{ value: Uint8Array | undefined; done: boolean }>;
	cancel: (reason?: unknown) => Promise<void>;
};

let _stdinReader: StreamReader | null = null;

function getStdinReader(): StreamReader {
	if (!_stdinReader) {
		const stream = new ReadableStream<Uint8Array>({
			start(controller) {
				process.stdin.on("data", (chunk: Buffer) => {
					try {
						controller.enqueue(new Uint8Array(chunk));
					} catch {
						/* ignore if closed */
					}
				});
				process.stdin.once("end", () => {
					try {
						controller.close();
					} catch {
						/* ignore */
					}
					_stdinReader = null;
				});
			},
		});
		_stdinReader = stream.getReader() as StreamReader;
	}
	return _stdinReader;
}

// ─── Read a single keypress (raw mode already active) ─────────────────────────

async function readKey(reader: StreamReader): Promise<string> {
	const { value, done } = await reader.read();
	if (done || !value) return "";
	return new TextDecoder().decode(value);
}

// ─── Turn cancel watcher (used during LLM turns) ─────────────────────────────
// While the LLM is streaming we keep stdin in raw mode so ESC and Ctrl+C arrive
// as raw bytes. We listen directly on process.stdin via a dedicated 'data'
// handler — NOT via the shared ReadableStream reader — so that the watcher and
// readline() never race for the same bytes. The caller must call the returned
// stop() in a finally block.

type WatchForCancelOptions = {
	allowSubagentEsc?: boolean;
};

function exitOnCtrlC(opts?: {
	printNewline?: boolean;
	disableBracketedPaste?: boolean;
}): never {
	if (opts?.printNewline) process.stdout.write("\n");
	if (opts?.disableBracketedPaste) process.stdout.write(BPASTE_DISABLE);
	terminal.setInterruptHandler(null);
	terminal.setRawMode(false);
	process.stdin.pause();
	terminal.restoreTerminal();
	process.exit(130);
}

export function watchForCancel(
	abortController: AbortController,
	options?: WatchForCancelOptions,
): () => void {
	if (!terminal.isTTY) return () => {};

	const onCancel = () => {
		cleanup();
		abortController.abort();
	};

	const getAction = options?.allowSubagentEsc
		? getSubagentControlAction
		: getTurnControlAction;

	const onData = (chunk: Buffer) => {
		const action = getAction(chunk);
		if (action === "cancel") {
			onCancel();
			return;
		}
		if (action === "quit") {
			cleanup();
			exitOnCtrlC({ printNewline: true });
		}
	};

	const cleanup = () => {
		process.stdin.removeListener("data", onData);
		terminal.setRawMode(false);
		process.stdin.pause();
	};

	terminal.setRawMode(true);
	process.stdin.resume();
	process.stdin.on("data", onData);

	return cleanup;
}

// ─── Paste handling ───────────────────────────────────────────────────────────

// ─── Main readline function ───────────────────────────────────────────────────

const PROMPT = c.green("▶ ");

const PROMPT_RAW_LEN = 2; // prompt is 2 visible chars

export async function readline(opts: { cwd?: string }): Promise<InputResult> {
	const cwd = opts.cwd ?? process.cwd();

	// Load history
	const history = getPromptHistory(200);
	let histIdx = history.length; // points past the end (current input)

	let buf = "";
	let cursor = 0;
	let savedInput = ""; // saved current line when navigating history
	let searchMode = false;
	let searchQuery = "";
	const pasteTokens = new Map<string, string>();
	const imageAttachments: ImageAttachment[] = []; // images collected during this prompt

	function prunePasteTokens(): void {
		const next = pruneInputPasteTokens(pasteTokens, buf, savedInput);
		pasteTokens.clear();
		for (const [token, text] of next) pasteTokens.set(token, text);
	}

	function insertText(text: string): void {
		const updated = insertAtCursor(buf, cursor, text);
		buf = updated.buf;
		cursor = updated.cursor;
	}

	function deleteWordBackward(): void {
		const updated = deleteWordBackwardInBuffer(buf, cursor);
		buf = updated.buf;
		cursor = updated.cursor;
		prunePasteTokens();
		renderPrompt();
	}

	function insertPasteToken(text: string): void {
		const token = createPasteToken(buf, pasteTokens);
		pasteTokens.set(token, text);
		insertText(token);
	}

	terminal.setRawMode(true);
	process.stdin.resume();
	process.stdout.write(BPASTE_ENABLE);

	const reader = getStdinReader();

	function renderPrompt(): void {
		const cols = process.stdout.columns ?? 80;
		const visualBuf = renderInputBuffer(buf, pasteTokens);
		const visualCursor = getVisualCursor(buf, cursor, pasteTokens);
		const { display, cursor: displayCursor } = buildPromptDisplay(
			visualBuf,
			visualCursor,
			Math.max(1, cols - PROMPT_RAW_LEN - 2),
		);

		const prompt = PROMPT;

		process.stdout.write(
			`${CLEAR_LINE}${prompt}${display}${CSI}${PROMPT_RAW_LEN + displayCursor + 1}G`,
		);
	}

	function renderSearchPrompt(): void {
		process.stdout.write(`${CLEAR_LINE}${c.cyan("search:")} ${searchQuery}█`);
	}

	function applyHistory(): void {
		if (histIdx < history.length) {
			buf = history[histIdx] ?? "";
		} else {
			buf = savedInput;
		}
		cursor = buf.length;
		prunePasteTokens();
		renderPrompt();
	}

	renderPrompt();

	try {
		while (true) {
			const raw = await readKey(reader);
			if (!raw) continue;

			// ── Search mode ────────────────────────────────────────────────────────
			if (searchMode) {
				if (raw === ESC) {
					searchMode = false;
					searchQuery = "";
					renderPrompt();
					continue;
				}
				if (raw === ENTER || raw === NEWLINE) {
					searchMode = false;
					cursor = buf.length;
					renderPrompt();
					continue;
				}
				if (raw === BACKSPACE) {
					searchQuery = searchQuery.slice(0, -1);
				} else if (raw >= " ") {
					searchQuery += raw;
				}
				// Find last match
				if (searchQuery) {
					const found = [...history]
						.reverse()
						.find((h) => h.includes(searchQuery));
					if (found) {
						buf = found;
						cursor = buf.length;
					}
				}
				renderSearchPrompt();
				continue;
			}

			// ── Bracketed paste ────────────────────────────────────────────────
			if (raw.includes(BPASTE_START)) {
				// Collect the full paste, potentially across multiple readKey chunks
				let accumulated = raw.slice(
					raw.indexOf(BPASTE_START) + BPASTE_START.length,
				);
				while (!accumulated.includes(BPASTE_END)) {
					const next = await readKey(reader);
					if (!next) break;
					accumulated += next;
				}
				const endIdx = accumulated.indexOf(BPASTE_END);
				const pasted =
					endIdx !== -1 ? accumulated.slice(0, endIdx) : accumulated;

				const imageResult = await tryExtractImageFromPaste(pasted, cwd);
				if (imageResult) {
					imageAttachments.push(imageResult.attachment);
					insertText(imageResult.label);
					renderPrompt();
					continue;
				}

				insertPasteToken(pasted);
				renderPrompt();
				continue;
			}

			// ── Escape sequences ──────────────────────────────────────────────────
			if (raw.startsWith(ESC)) {
				// Arrow keys: ESC [ A/B/C/D
				if (raw === `${CSI}A` || raw === `${ESC}[A`) {
					// Up arrow — history prev
					if (histIdx === history.length) savedInput = buf;
					if (histIdx > 0) {
						histIdx--;
						applyHistory();
					}
					continue;
				}
				if (raw === `${CSI}B` || raw === `${ESC}[B`) {
					// Down arrow — history next
					if (histIdx < history.length) {
						histIdx++;
						applyHistory();
					}
					continue;
				}
				if (raw === `${CSI}C` || raw === `${ESC}[C`) {
					// Right arrow
					if (cursor < buf.length) {
						cursor++;
						renderPrompt();
					}
					continue;
				}
				if (raw === `${CSI}D` || raw === `${ESC}[D`) {
					// Left arrow
					if (cursor > 0) {
						cursor--;
						renderPrompt();
					}
					continue;
				}
				// Alt+Left (word left): ESC b or ESC [1;3D
				if (raw === `${ESC}b` || raw === `${ESC}[1;3D`) {
					cursor = moveCursorWordLeft(buf, cursor);
					renderPrompt();
					continue;
				}
				// Alt+Right (word right): ESC f or ESC [1;3C
				if (raw === `${ESC}f` || raw === `${ESC}[1;3C`) {
					cursor = moveCursorWordRight(buf, cursor);
					renderPrompt();
					continue;
				}
				// Alt+Backspace (delete word backward): ESC DEL
				if (raw === `${ESC}${BACKSPACE}`) {
					deleteWordBackward();
					continue;
				}
				if (raw === ESC) {
					process.stdout.write("\n");
					return { type: "interrupt" };
				}
				continue;
			}

			// ── Control keys ──────────────────────────────────────────────────────
			if (raw === CTRL_C) {
				exitOnCtrlC({ printNewline: true, disableBracketedPaste: true });
			}

			if (raw === CTRL_D) {
				process.stdout.write("\n");
				return { type: "eof" };
			}

			if (raw === CTRL_A) {
				cursor = 0;
				renderPrompt();
				continue;
			}

			if (raw === CTRL_E) {
				cursor = buf.length;
				renderPrompt();
				continue;
			}

			if (raw === CTRL_W) {
				// Delete word before cursor
				deleteWordBackward();
				continue;
			}

			if (raw === CTRL_U) {
				buf = buf.slice(cursor);
				cursor = 0;
				prunePasteTokens();
				renderPrompt();
				continue;
			}

			if (raw === CTRL_K) {
				buf = buf.slice(0, cursor);
				prunePasteTokens();
				renderPrompt();
				continue;
			}

			if (raw === CTRL_L) {
				process.stdout.write("\x1B[2J\x1B[H");
				renderPrompt();
				continue;
			}

			if (raw === CTRL_R) {
				searchMode = true;
				searchQuery = "";
				renderSearchPrompt();
				continue;
			}

			if (raw === BACKSPACE) {
				if (cursor > 0) {
					buf = buf.slice(0, cursor - 1) + buf.slice(cursor);
					cursor--;
					prunePasteTokens();
					renderPrompt();
				}
				continue;
			}

			if (raw === TAB) {
				const beforeCursor = buf.slice(0, cursor);
				const completion = await getInputCompletion(beforeCursor, cursor, cwd);

				if (completion?.completions.length === 1 && completion.completions[0]) {
					const replacement = completion.completions[0];
					buf =
						buf.slice(0, completion.replaceFrom) +
						replacement +
						buf.slice(cursor);
					cursor = completion.replaceFrom + replacement.length;
					renderPrompt();
				} else if ((completion?.completions.length ?? 0) > 1) {
					process.stdout.write("\n");
					for (const item of completion?.completions ?? []) {
						process.stdout.write(`  ${item}\n`);
					}
					renderPrompt();
				}

				continue;
			}

			// ── Enter — submit ────────────────────────────────────────────────────
			if (raw === ENTER || raw === NEWLINE) {
				const expanded = expandInputBuffer(buf, pasteTokens);
				pasteTokens.clear();
				const text = expanded.trim();
				process.stdout.write("\n");
				buf = "";
				cursor = 0;
				histIdx = history.length + (text ? 1 : 0);

				if (!text && !imageAttachments.length) {
					renderPrompt();
					continue;
				}

				// Strip image placeholder labels — actual image data is in imageAttachments.
				// Do this before history and before returning so every path sees clean text.
				const cleanText = imageAttachments.length
					? text.replace(/\[image: [^\]]+\]/g, "").trim()
					: text;
				addPromptHistory(cleanText);

				// Slash commands
				if (cleanText.startsWith("/")) {
					const spaceIdx = cleanText.indexOf(" ");
					const command =
						spaceIdx === -1 ? cleanText.slice(1) : cleanText.slice(1, spaceIdx);
					const args =
						spaceIdx === -1 ? "" : cleanText.slice(spaceIdx + 1).trim();
					return { type: "command", command, args };
				}

				// Shell passthrough
				if (cleanText.startsWith("!")) {
					return { type: "shell", command: cleanText.slice(1).trim() };
				}

				return {
					type: "submit",
					text: cleanText,
					images: imageAttachments,
				};
			}

			// ── Multi-char chunks ──────────────────────────────────────────────────
			// Bracketed paste is handled above. Other multi-char chunks are usually
			// coalesced typing or a non-bracketed paste from a terminal that does not
			// support bracketed paste.
			if (raw.length > 1) {
				const chunk = raw.replace(/\r?\n$/, "");
				const imageResult = await tryExtractImageFromPaste(chunk, cwd);
				if (imageResult) {
					imageAttachments.push(imageResult.attachment);
					insertText(imageResult.label);
					renderPrompt();
					continue;
				}

				if (chunk.includes("\n") || chunk.includes("\r")) {
					insertPasteToken(chunk);
				} else {
					insertText(chunk);
				}
				renderPrompt();
				continue;
			}

			// ── Printable characters ──────────────────────────────────────────────
			if (raw >= " " || raw === "\t") {
				insertText(raw);
				renderPrompt();
			}
		}
	} finally {
		// Do NOT cancel the shared reader — it is reused across readline() calls.
		// Just reset raw mode and pause stdin until the next prompt.
		process.stdout.write(BPASTE_DISABLE);
		terminal.setRawMode(false);
		process.stdin.pause();
	}
}
