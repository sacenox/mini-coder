import { join, relative } from "node:path";
import * as c from "yoctocolors";
import { addPromptHistory, getPromptHistory } from "../session/db.ts";

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

export type InputResult =
	| { type: "submit"; text: string }
	| { type: "interrupt" }
	| { type: "eof" }
	| { type: "command"; command: string; args: string }
	| { type: "shell"; command: string };

// ─── File autocomplete ────────────────────────────────────────────────────────

async function getFileCompletions(
	prefix: string,
	cwd: string,
): Promise<string[]> {
	const query = prefix.startsWith("@") ? prefix.slice(1) : prefix;
	const glob = new Bun.Glob(`**/*${query}*`);
	const results: string[] = [];
	for await (const file of glob.scan({ cwd, onlyFiles: true })) {
		if (file.includes("node_modules") || file.includes(".git")) continue;
		results.push(`@${relative(cwd, join(cwd, file))}`);
		if (results.length >= 10) break;
	}
	return results;
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

// ─── Main readline function ───────────────────────────────────────────────────

const PROMPT = c.green("▶ ");
const PROMPT_PLAN = c.yellow("⬢ ");
const PROMPT_RAW_LEN = 2; // both prompts are 2 visible chars

export async function readline(opts: {
	cwd?: string;
	planMode?: boolean;
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

	process.stdin.setRawMode(true);
	process.stdin.resume();

	const reader = getStdinReader();

	function renderPrompt(): void {
		const cols = process.stdout.columns ?? 80;
		const display =
			buf.length > cols - PROMPT_RAW_LEN - 2
				? `…${buf.slice(-(cols - PROMPT_RAW_LEN - 3))}`
				: buf;

		const prompt = opts.planMode ? PROMPT_PLAN : PROMPT;
		process.stdout.write(
			`${CLEAR_LINE}${prompt}${display}${CSI}${PROMPT_RAW_LEN + cursor + 1}G`,
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
				renderPrompt();
				continue;
			}

			if (raw === CTRL_U) {
				buf = buf.slice(cursor);
				cursor = 0;
				renderPrompt();
				continue;
			}

			if (raw === CTRL_K) {
				buf = buf.slice(0, cursor);
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
					renderPrompt();
				}
				continue;
			}

			if (raw === TAB) {
				// File autocomplete for @-prefixed words
				const beforeCursor = buf.slice(0, cursor);
				const atMatch = beforeCursor.match(/@(\S*)$/);
				if (atMatch) {
					const completions = await getFileCompletions(atMatch[0], cwd);
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
				const text = buf.trim();
				process.stdout.write("\n");
				buf = "";
				cursor = 0;
				histIdx = history.length + (text ? 1 : 0);

				if (!text) {
					renderPrompt();
					continue;
				}

				addPromptHistory(text);

				// Slash commands
				if (text.startsWith("/")) {
					const spaceIdx = text.indexOf(" ");
					const command =
						spaceIdx === -1 ? text.slice(1) : text.slice(1, spaceIdx);
					const args = spaceIdx === -1 ? "" : text.slice(spaceIdx + 1).trim();
					return { type: "command", command, args };
				}

				// Shell passthrough
				if (text.startsWith("!")) {
					return { type: "shell", command: text.slice(1).trim() };
				}

				return { type: "submit", text };
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
		process.stdin.setRawMode(false);
		process.stdin.pause();
	}
}
