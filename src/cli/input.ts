import { join, relative } from "node:path";
import * as c from "yoctocolors";
import { addPromptHistory, getPromptHistory } from "../session/db.ts";
import { loadAgents } from "./agents.ts";
import {
	type ImageAttachment,
	isImageFilename,
	loadImageFile,
} from "./image-types.ts";
import { loadSkills } from "./skills.ts";

// ─── ANSI escape sequences ────────────────────────────────────────────────────

const ESC = "\x1B";
const CSI = `${ESC}[`;
const CLEAR_LINE = `\r${CSI}2K`;
const CURSOR_LEFT = `${CSI}D`;
const CURSOR_RIGHT = `${CSI}C`;
const CURSOR_UP = `${CSI}A`;
const CURSOR_DOWN = `${CSI}B`;
const SAVE_CURSOR = `${CSI}s`;
const RESTORE_CURSOR = `${CSI}u`;
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

// ─── File autocomplete ────────────────────────────────────────────────────────

async function getAtCompletions(
	prefix: string,
	cwd: string,
): Promise<string[]> {
	const query = prefix.startsWith("@") ? prefix.slice(1) : prefix;
	const results: string[] = [];
	const MAX = 10;

	// Skills: @<skill-name>
	const skills = loadSkills(cwd);
	for (const [name] of skills) {
		if (results.length >= MAX) break;
		if (name.includes(query)) results.push(`@${name}`);
	}

	// Agents: @<agent-name>
	const agents = loadAgents(cwd);
	for (const [name] of agents) {
		if (results.length >= MAX) break;
		if (name.includes(query)) results.push(`@${name}`);
	}

	// Files: @<relative-path> — fill remaining slots up to MAX
	if (results.length < MAX) {
		const glob = new Bun.Glob(`**/*${query}*`);
		for await (const file of glob.scan({ cwd, onlyFiles: true })) {
			if (file.includes("node_modules") || file.includes(".git")) continue;
			results.push(`@${relative(cwd, join(cwd, file))}`);
			if (results.length >= MAX) break;
		}
	}

	return results;
}

// ─── Image detection ─────────────────────────────────────────────────────────

/**
 * Parse a pasted chunk and extract image attachments if present.
 *
 * Handles two cases:
 *  1. The paste is a `data:image/...;base64,...` data URL.
 *  2. The paste is a file path pointing to an image on disk.
 *
 * Returns `{ attachment, label }` when an image is found so the caller can
 * replace the paste buffer with a placeholder label, or `null` when the paste
 * is plain text.
 */
async function tryExtractImageFromPaste(
	pasted: string,
	cwd: string,
): Promise<{ attachment: ImageAttachment; label: string } | null> {
	const trimmed = pasted.trim();

	// Case 1: base64 data URL — only accept if explicitly base64-encoded
	// (non-base64 data URLs like data:image/svg+xml,<svg>... would be sent as
	// garbled base64 to the model if we don't guard here)
	if (trimmed.startsWith("data:image/")) {
		const commaIdx = trimmed.indexOf(",");
		if (commaIdx !== -1 && trimmed.slice(0, commaIdx).includes(";base64")) {
			const header = trimmed.slice(0, commaIdx); // "data:image/png;base64"
			const b64 = trimmed.slice(commaIdx + 1);
			const mediaType = header.split(";")[0]?.slice(5) ?? "image/png"; // strip "data:"
			return {
				attachment: { data: b64, mediaType },
				label: `[image: ${mediaType}]`,
			};
		}
	}

	// Case 2: file path to an image
	if (!trimmed.includes(" ") && isImageFilename(trimmed)) {
		const filePath = trimmed.startsWith("/") ? trimmed : join(cwd, trimmed);
		const attachment = await loadImageFile(filePath);
		if (attachment) {
			const name = filePath.split("/").pop() ?? trimmed;
			return { attachment, label: `[image: ${name}]` };
		}
	}

	return null;
}

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

// ─── Interrupt watcher (used during LLM turns) ────────────────────────────────
// While the LLM is streaming we keep stdin in raw mode so that Ctrl+C arrives
// as byte 0x03. We listen directly on process.stdin via a dedicated 'data'
// handler — NOT via the shared ReadableStream reader — so that the watcher and
// readline() never race for the same bytes.  The caller must call the returned
// stop() in a finally block.

export function watchForInterrupt(
	abortController: AbortController,
): () => void {
	if (!process.stdin.isTTY) return () => {};

	const onData = (chunk: Buffer) => {
		for (const byte of chunk) {
			if (byte === 0x03) {
				// Ctrl+C received — abort and clean up immediately.
				cleanup();
				abortController.abort();
				return;
			}
		}
	};

	const cleanup = () => {
		process.stdin.removeListener("data", onData);
		process.stdin.setRawMode(false);
		process.stdin.pause();
	};

	process.stdin.setRawMode(true);
	process.stdin.resume();
	process.stdin.on("data", onData);

	return cleanup;
}

// ─── Paste handling ───────────────────────────────────────────────────────────

const PASTE_SENTINEL = "\x00PASTE\x00";
const PASTE_SENTINEL_LEN = PASTE_SENTINEL.length;

export function pasteLabel(text: string): string {
	const lines = text.split("\n");
	const first = lines[0] ?? "";
	const preview = first.length > 40 ? `${first.slice(0, 40)}…` : first;
	const extra = lines.length - 1;
	const more = extra > 0 ? ` +${extra} more line${extra === 1 ? "" : "s"}` : "";
	return `[pasted: "${preview}"${more}]`;
}

// ─── Main readline function ───────────────────────────────────────────────────

const PROMPT = c.green("▶ ");
const PROMPT_PLAN = c.yellow("⬢ ");
const PROMPT_RALPH = c.magenta("↻ ");

const PROMPT_RAW_LEN = 2; // both prompts are 2 visible chars

export async function readline(opts: {
	cwd?: string;
	planMode?: boolean;
	ralphMode?: boolean;
}): Promise<InputResult> {
	const cwd = opts.cwd ?? process.cwd();

	// Load history
	const history = getPromptHistory(200);
	let histIdx = history.length; // points past the end (current input)

	let buf = "";
	let cursor = 0;
	let savedInput = ""; // saved current line when navigating history
	let searchMode = false;
	let searchQuery = "";
	let pasteBuffer: string | null = null; // full text of a pending paste
	const imageAttachments: ImageAttachment[] = []; // images collected during this prompt

	process.stdin.setRawMode(true);
	process.stdin.resume();
	process.stdout.write(BPASTE_ENABLE);

	const reader = getStdinReader();

	function renderPrompt(): void {
		const cols = process.stdout.columns ?? 80;
		// Replace paste sentinel and image labels with styled placeholders for display
		const visualBuf = (
			pasteBuffer
				? buf.replace(PASTE_SENTINEL, c.dim(pasteLabel(pasteBuffer)))
				: buf
		).replace(/\[image: [^\]]+\]/g, (m) => c.dim(c.cyan(m)));

		// For cursor positioning we need the visual length without the sentinel substitution
		const visualCursor = pasteBuffer
			? (() => {
					const sentinelPos = buf.indexOf(PASTE_SENTINEL);
					if (sentinelPos === -1 || cursor <= sentinelPos) return cursor;
					// cursor is after the sentinel: shift by (label len - sentinel len)
					return cursor - PASTE_SENTINEL_LEN + pasteLabel(pasteBuffer).length;
				})()
			: cursor;
		const display =
			visualBuf.length > cols - PROMPT_RAW_LEN - 2
				? `…${visualBuf.slice(-(cols - PROMPT_RAW_LEN - 3))}`
				: visualBuf;

		const prompt = opts.planMode
			? PROMPT_PLAN
			: opts.ralphMode
				? PROMPT_RALPH
				: PROMPT;

		process.stdout.write(
			`${CLEAR_LINE}${prompt}${display}${CSI}${PROMPT_RAW_LEN + visualCursor + 1}G`,
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
					buf = buf.slice(0, cursor) + imageResult.label + buf.slice(cursor);
					cursor += imageResult.label.length;
					renderPrompt();
					continue;
				}

				pasteBuffer = pasted;
				buf = buf.slice(0, cursor) + PASTE_SENTINEL + buf.slice(cursor);
				cursor += PASTE_SENTINEL_LEN;
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
					while (cursor > 0 && buf[cursor - 1] === " ") cursor--;
					while (cursor > 0 && buf[cursor - 1] !== " ") cursor--;
					renderPrompt();
					continue;
				}
				// Alt+Right (word right): ESC f or ESC [1;3C
				if (raw === `${ESC}f` || raw === `${ESC}[1;3C`) {
					while (cursor < buf.length && buf[cursor] === " ") cursor++;
					while (cursor < buf.length && buf[cursor] !== " ") cursor++;
					renderPrompt();
					continue;
				}
				// Alt+Backspace (delete word backward): ESC DEL
				if (raw === `${ESC}${BACKSPACE}`) {
					const end = cursor;
					while (cursor > 0 && buf[cursor - 1] === " ") cursor--;
					while (cursor > 0 && buf[cursor - 1] !== " ") cursor--;
					buf = buf.slice(0, cursor) + buf.slice(end);
					if (pasteBuffer && !buf.includes(PASTE_SENTINEL)) pasteBuffer = null;
					renderPrompt();
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
				process.stdout.write("\n");
				return { type: "interrupt" };
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
				const end = cursor;
				while (cursor > 0 && buf[cursor - 1] === " ") cursor--;
				while (cursor > 0 && buf[cursor - 1] !== " ") cursor--;
				buf = buf.slice(0, cursor) + buf.slice(end);
				if (pasteBuffer && !buf.includes(PASTE_SENTINEL)) pasteBuffer = null;
				renderPrompt();
				continue;
			}

			if (raw === CTRL_U) {
				buf = buf.slice(cursor);
				cursor = 0;
				if (pasteBuffer && !buf.includes(PASTE_SENTINEL)) pasteBuffer = null;
				renderPrompt();
				continue;
			}

			if (raw === CTRL_K) {
				buf = buf.slice(0, cursor);
				if (pasteBuffer && !buf.includes(PASTE_SENTINEL)) pasteBuffer = null;
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
					if (pasteBuffer && !buf.includes(PASTE_SENTINEL)) pasteBuffer = null;
					renderPrompt();
				}
				continue;
			}

			if (raw === TAB) {
				// File autocomplete for @-prefixed words
				const beforeCursor = buf.slice(0, cursor);
				const atMatch = beforeCursor.match(/@(\S*)$/);
				if (atMatch) {
					const completions = await getAtCompletions(atMatch[0], cwd);
					if (completions.length === 1 && completions[0]) {
						const replacement = completions[0];
						buf =
							buf.slice(0, cursor - (atMatch[0] ?? "").length) +
							replacement +
							buf.slice(cursor);
						cursor = cursor - (atMatch[0] ?? "").length + replacement.length;
						renderPrompt();
					} else if (completions.length > 1) {
						process.stdout.write("\n");
						for (const c of completions) process.stdout.write(`  ${c}\n`);
						renderPrompt();
					}
				}
				continue;
			}

			// ── Enter — submit ────────────────────────────────────────────────────
			if (raw === ENTER || raw === NEWLINE) {
				// Expand paste sentinel before trimming/submitting
				const expanded = pasteBuffer
					? buf.replace(PASTE_SENTINEL, pasteBuffer)
					: buf;
				pasteBuffer = null;
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

			// ── Paste detection ───────────────────────────────────────────────────
			// A chunk with more than one character that isn't an escape sequence is
			// almost certainly a clipboard paste. Capture it and show a placeholder.
			if (raw.length > 1) {
				// Strip trailing newline that some terminals append on paste
				const pasted = raw.replace(/\r?\n$/, "");

				// Check if this is an image (data URL or image file path)
				const imageResult = await tryExtractImageFromPaste(pasted, cwd);
				if (imageResult) {
					imageAttachments.push(imageResult.attachment);
					// Insert the plain label into buf (no sentinel — nothing to expand at submit)
					buf = buf.slice(0, cursor) + imageResult.label + buf.slice(cursor);
					cursor += imageResult.label.length;
					renderPrompt();
					continue;
				}

				pasteBuffer = pasted;
				buf = buf.slice(0, cursor) + PASTE_SENTINEL + buf.slice(cursor);
				cursor += PASTE_SENTINEL_LEN;
				renderPrompt();
				continue;
			}

			// ── Printable characters ──────────────────────────────────────────────
			if (raw >= " " || raw === "\t") {
				buf = buf.slice(0, cursor) + raw + buf.slice(cursor);
				cursor++;
				renderPrompt();
			}
		}
	} finally {
		// Do NOT cancel the shared reader — it is reused across readline() calls.
		// Just reset raw mode and pause stdin until the next prompt.
		process.stdout.write(BPASTE_DISABLE);
		process.stdin.setRawMode(false);
		process.stdin.pause();
	}
}
