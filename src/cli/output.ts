import { homedir } from "node:os";

import * as c from "yoctocolors";
import type { CoreMessage } from "../llm-api/turn.ts";
import type { TurnEvent } from "../llm-api/types.ts";
import type { SubagentOutput } from "../tools/subagent.ts";
import { renderChunk } from "./markdown.ts";

const HOME = homedir();
declare const __PACKAGE_VERSION__: string;
const PACKAGE_VERSION =
	typeof __PACKAGE_VERSION__ !== "undefined" ? __PACKAGE_VERSION__ : "unknown";

/** Replace the home directory prefix with `~` for display. */
export function tildePath(p: string): string {
	return p.startsWith(HOME) ? `~${p.slice(HOME.length)}` : p;
}

// ─── Terminal restore ─────────────────────────────────────────────────────────

export function restoreTerminal(): void {
	try {
		process.stderr.write("\x1B[?25h");
		process.stderr.write("\r\x1B[2K");
	} catch {
		/* ignore */
	}
	try {
		if (process.stdin.isTTY && process.stdin.isRaw) {
			process.stdin.setRawMode(false);
		}
	} catch {
		/* ignore */
	}
}

export function registerTerminalCleanup(): void {
	const cleanup = () => restoreTerminal();
	process.on("exit", cleanup);
	process.on("SIGTERM", () => {
		cleanup();
		process.exit(143);
	});
	process.on("SIGINT", () => {
		cleanup();
		process.exit(130);
	});
	process.on("uncaughtException", (err) => {
		cleanup();
		throw err;
	});
	process.on("unhandledRejection", (reason) => {
		cleanup();
		throw reason instanceof Error ? reason : new Error(String(reason));
	});
}

// ─── Spinner ──────────────────────────────────────────────────────────────────

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export class Spinner {
	private frame = 0;
	private timer: Timer | null = null;
	private label = "";

	start(label = ""): void {
		this.label = label;
		if (this.timer) return;
		process.stderr.write("\x1B[?25l");
		this._tick();
		this.timer = setInterval(() => this._tick(), 80);
	}

	stop(): void {
		if (!this.timer) return;
		clearInterval(this.timer);
		this.timer = null;
		process.stderr.write("\r\x1B[2K\x1B[?25h");
	}

	update(label: string): void {
		this.label = label;
	}

	private _tick(): void {
		const f = FRAMES[this.frame++ % FRAMES.length] ?? "⠋";
		const label = this.label ? c.dim(` ${this.label}`) : "";
		process.stderr.write(`\r${c.dim(f)}${label}`);
	}
}

// ─── Primitives ───────────────────────────────────────────────────────────────

export function writeln(text = ""): void {
	process.stdout.write(`${text}\n`);
}

export function write(text: string): void {
	process.stdout.write(text);
}

/** Strip the `linenum:hash| ` prefix that hashline-formatted tool outputs include. */
function stripHashlinePrefix(text: string): string {
	return text.replace(/^\d+:[0-9a-f]{2}\| /, "");
}

// ─── Glyph vocabulary ─────────────────────────────────────────────────────────
// All from the 16-color ANSI palette — inherits terminal theme.

export const G = {
	// role markers
	prompt: c.green("›"), // user input marker in history
	reply: c.cyan("◆"), // assistant reply start

	// tool action glyphs (compact, one per line)
	search: c.yellow("?"), // glob / grep
	read: c.dim("←"), // read file
	write: c.green("✎"), // edit / create file
	run: c.dim("$"), // shell
	agent: c.cyan("⇢"), // subagent
	mcp: c.yellow("⚙"), // mcp tools

	// status
	ok: c.green("✔"),
	err: c.red("✖"),
	warn: c.yellow("!"),
	info: c.dim("·"),
	diff_add: c.green("+"),
	diff_del: c.red("-"),
	diff_hdr: c.cyan("@"),
};

// ─── Tool call — single line summary ─────────────────────────────────────────

function toolGlyph(name: string): string {
	if (name === "glob" || name === "grep") return G.search;
	if (name === "read") return G.read;
	if (name === "create" || name === "replace" || name === "insert")
		return G.write;
	if (name === "shell") return G.run;
	if (name === "subagent") return G.agent;
	if (name.startsWith("mcp_")) return G.mcp;
	return G.info;
}

/** Compact one-line summary of a tool call. */
function toolCallLine(name: string, args: unknown): string {
	const a =
		args && typeof args === "object" ? (args as Record<string, unknown>) : {};

	if (name === "glob") {
		const pattern = String(a.pattern ?? "");
		const cwd = a.cwd ? String(a.cwd) : "";
		return `${G.search} ${c.dim("glob")} ${c.bold(pattern)}${cwd ? c.dim(` in ${cwd}`) : ""}`;
	}
	if (name === "grep") {
		const flags = [
			a.include ? String(a.include) : null,
			a.caseSensitive === false ? "i" : null,
		]
			.filter(Boolean)
			.join(" ");
		const pattern = String(a.pattern ?? "");
		return `${G.search} ${c.dim("grep")} ${c.bold(pattern)}${flags ? c.dim(`  ${flags}`) : ""}`;
	}
	if (name === "read") {
		const line = Number.isFinite(a.line as number) ? Number(a.line) : null;
		const count = Number.isFinite(a.count as number) ? Number(a.count) : null;
		const range =
			line || count ? c.dim(`:${line ?? 1}${count ? `+${count}` : ""}`) : "";
		return `${G.read} ${c.dim("read")} ${String(a.path ?? "")}${range}`;
	}
	if (name === "create") {
		return `${G.write} ${c.dim("create")} ${c.bold(String(a.path ?? ""))}`;
	}
	if (name === "replace") {
		const range = a.endAnchor
			? c.dim(` ${a.startAnchor}–${a.endAnchor}`)
			: c.dim(` ${a.startAnchor}`);
		const verb =
			a.newContent === undefined || a.newContent === "" ? "delete" : "replace";
		return `${G.write} ${c.dim(verb)} ${c.bold(String(a.path ?? ""))}${range}`;
	}
	if (name === "insert") {
		return `${G.write} ${c.dim(`insert ${a.position ?? ""}`)} ${c.bold(String(a.path ?? ""))}${c.dim(` @ ${a.anchor}`)}`;
	}
	if (name === "shell") {
		const cmd = String(a.command ?? "");
		const shortCmd = cmd.length > 72 ? `${cmd.slice(0, 69)}…` : cmd;
		return `${G.run} ${c.dim("$")} ${shortCmd}`;
	}
	if (name === "subagent") {
		const prompt = String(a.prompt ?? "");
		const shortPrompt = prompt.length > 60 ? `${prompt.slice(0, 57)}…` : prompt;
		return `${G.agent} ${c.dim("subagent")} ${c.dim(shortPrompt)}`;
	}
	if (name.startsWith("mcp_")) {
		return `${G.mcp} ${c.dim(name)}`;
	}
	return `${toolGlyph(name)} ${c.dim(name)}`;
}

export function renderToolCall(toolName: string, args: unknown): void {
	writeln(`  ${toolCallLine(toolName, args)}`);
}

export function renderHook(
	toolName: string,
	scriptPath: string,
	success: boolean,
): void {
	const short = scriptPath.replace(HOME, "~");

	if (success) {
		writeln(`    ${G.ok} ${c.dim(`hook post-${toolName}`)}`);
	} else {
		writeln(
			`    ${G.err} ${c.red(`hook post-${toolName} failed`)} ${c.dim(short)}`,
		);
	}
}

// ─── Tool result — compact data ───────────────────────────────────────────────

/**
 * Render a compact one-liner status for a tool result inside a subagent tree.
 * `indent` is the prefix string (spaces) for the current tree depth.
 */
function renderToolResultInline(
	toolName: string,
	result: unknown,
	isError: boolean,
	indent: string,
): void {
	if (isError) {
		const msg =
			typeof result === "string"
				? result
				: result instanceof Error
					? result.message
					: JSON.stringify(result);
		const oneLiner = msg.split("\n")[0] ?? msg;
		writeln(`${indent}${G.err} ${c.red(oneLiner)}`);
		return;
	}

	if (toolName === "glob") {
		const r = result as { files: string[]; truncated: boolean };
		const n = r.files.length;
		writeln(
			`${indent}${G.info} ${c.dim(n === 0 ? "no matches" : `${n} file${n === 1 ? "" : "s"}${r.truncated ? " (capped)" : ""}`)}`,
		);
		return;
	}

	if (toolName === "grep") {
		const r = result as { matches: unknown[]; truncated: boolean };
		const n = r.matches.length;
		writeln(
			`${indent}${G.info} ${c.dim(n === 0 ? "no matches" : `${n} match${n === 1 ? "" : "es"}${r.truncated ? " (capped)" : ""}`)}`,
		);
		return;
	}

	if (toolName === "read") {
		const r = result as { totalLines: number; truncated: boolean };
		writeln(
			`${indent}${G.info} ${c.dim(`${r.totalLines} lines${r.truncated ? " (truncated)" : ""}`)}`,
		);
		return;
	}

	if (toolName === "create") {
		const r = result as { path: string; created: boolean };
		const verb = r.created ? c.green("created") : c.dim("overwritten");
		writeln(`${indent}${G.ok} ${verb} ${r.path}`);
		return;
	}

	if (toolName === "replace" || toolName === "insert") {
		const r = result as { path: string; deleted?: boolean };
		const verb =
			toolName === "insert" ? "inserted" : r.deleted ? "deleted" : "replaced";
		writeln(`${indent}${G.ok} ${c.dim(verb)} ${r.path}`);
		return;
	}

	if (toolName === "shell") {
		const r = result as {
			exitCode: number;
			success: boolean;
			timedOut: boolean;
		};
		const badge = r.timedOut
			? c.yellow("timeout")
			: r.success
				? c.green(`✔ ${r.exitCode}`)
				: c.red(`✖ ${r.exitCode}`);
		writeln(`${indent}${badge}`);
		return;
	}

	if (toolName === "subagent") {
		// Activity and token counts are now streamed live.
		return;
	}

	if (toolName.startsWith("mcp_")) {
		const content = Array.isArray(result) ? result : [result];
		const first = (content as Array<{ type?: string; text?: string }>)[0];
		if (first?.type === "text" && first.text) {
			const oneLiner = first.text.split("\n")[0] ?? "";
			if (oneLiner)
				writeln(
					`${indent}${G.info} ${c.dim(oneLiner.length > 80 ? `${oneLiner.slice(0, 77)}…` : oneLiner)}`,
				);
		}
		return;
	}

	// Generic: one-line JSON
	const text = JSON.stringify(result);
	writeln(
		`${indent}${G.info} ${c.dim(text.length > 80 ? `${text.slice(0, 77)}…` : text)}`,
	);
}

export function formatSubagentLabel(
	laneId: number,
	parentLabel?: string,
): string {
	const numStr = parentLabel
		? `${parentLabel.replace(/[\[\]]/g, "")}.${laneId}`
		: `${laneId}`;
	return c.dim(c.cyan(`[${numStr}]`));
}

const laneBuffers = new Map<number, string>();

export function renderSubagentEvent(
	event: TurnEvent,
	opts: {
		laneId: number;
		parentLabel?: string | undefined;
		activeLanes: Set<number>;
	},
): void {
	const { laneId, parentLabel, activeLanes } = opts;

	const labelStr = formatSubagentLabel(laneId, parentLabel);
	const prefix = activeLanes.size > 1 ? `${labelStr} ` : "";

	if (event.type === "text-delta") {
		const buf = (laneBuffers.get(laneId) ?? "") + event.delta;
		const lines = buf.split("\n");
		if (lines.length > 1) {
			for (let i = 0; i < lines.length - 1; i++) {
				writeln(`${prefix}${lines[i]}`);
			}
			laneBuffers.set(laneId, lines[lines.length - 1] ?? "");
		} else {
			laneBuffers.set(laneId, buf);
		}
	} else if (event.type === "tool-call-start") {
		writeln(`${prefix}${toolCallLine(event.toolName, event.args)}`);
	} else if (event.type === "tool-result") {
		// Use inlineResultSummary logic directly here
		renderToolResultInline(
			event.toolName,
			event.result,
			event.isError,
			`${prefix}  `,
		);
	} else if (event.type === "turn-complete") {
		// Flush buffer if any
		const buf = laneBuffers.get(laneId);
		if (buf) {
			writeln(`${prefix}${buf}`);
			laneBuffers.delete(laneId);
		}
		if (event.inputTokens > 0 || event.outputTokens > 0) {
			writeln(
				`${prefix}${c.dim(`↑${event.inputTokens} ↓${event.outputTokens}`)}`,
			);
		}
	} else if (event.type === "turn-error") {
		laneBuffers.delete(laneId);
		const msg = event.error.message.split("\n")[0] ?? event.error.message;
		writeln(`${prefix}${G.err} ${c.red(msg)}`);
	}
}

export function renderToolResult(
	toolName: string,
	result: unknown,
	isError: boolean,
): void {
	if (isError) {
		const msg =
			typeof result === "string"
				? result
				: result instanceof Error
					? result.message
					: JSON.stringify(result);
		// Trim to one line for error summaries
		const oneLiner = msg.split("\n")[0] ?? msg;
		writeln(`    ${G.err} ${c.red(oneLiner)}`);
		return;
	}

	if (toolName === "glob") {
		const r = result as { files: string[]; truncated: boolean };
		const files = r.files;
		if (files.length === 0) {
			writeln(`    ${G.info} ${c.dim("no matches")}`);
			return;
		}

		// Show up to 12 files, grouped by top-level directory for readability
		const show = files.slice(0, 12);
		const rest = files.length - show.length;

		// Find common prefix to strip for cleaner display
		const prefix = commonPrefix(show);
		for (const f of show) {
			const rel =
				prefix && f.startsWith(prefix)
					? c.dim(prefix) + f.slice(prefix.length)
					: f;
			writeln(`    ${c.dim("·")} ${rel}`);
		}
		if (rest > 0) writeln(`    ${c.dim(`  +${rest} more`)}`);
		if (r.truncated) writeln(`    ${c.dim("  (results capped)")}`);
		return;
	}

	if (toolName === "grep") {
		const r = result as {
			matches: Array<{
				file: string;
				line: number;
				text: string;
				context?: Array<{ line: number; text: string; isMatch: boolean }>;
			}>;
			truncated: boolean;
		};
		if (r.matches.length === 0) {
			writeln(`    ${G.info} ${c.dim("no matches")}`);
			return;
		}

		// Deduplicate by file, show file:line and match text
		const seen = new Set<string>();
		let shown = 0;
		for (const m of r.matches) {
			if (shown >= 10) break;
			const key = m.file;
			const fileLabel = seen.has(key)
				? c.dim(" ".repeat(m.file.length + 1))
				: c.dim(`${m.file}:`);
			seen.add(key);
			writeln(
				`    ${fileLabel}${c.dim(String(m.line))}  ${stripHashlinePrefix(m.text).trim()}`,
			);
			shown++;
		}
		const rest = r.matches.length - shown;
		if (rest > 0) writeln(`    ${c.dim(`  +${rest} more`)}`);
		if (r.truncated) writeln(`    ${c.dim("  (results capped)")}`);
		return;
	}

	if (toolName === "read") {
		const r = result as {
			path: string;
			line: number;
			totalLines: number;
			truncated: boolean;
			content?: string;
		};
		const linesReturned = r.content ? r.content.split("\n").length : 0;
		const endLine = linesReturned > 0 ? r.line + linesReturned - 1 : r.line;
		const range =
			r.line === 1 && endLine === r.totalLines
				? `${r.totalLines} lines`
				: `lines ${r.line}–${endLine} of ${r.totalLines}`;
		writeln(
			`    ${G.info} ${c.dim(`${r.path}  ${range}${r.truncated ? "  (truncated)" : ""}`)}`,
		);
		return;
	}

	if (toolName === "create") {
		const r = result as { path: string; diff: string; created: boolean };
		const verb = r.created ? c.green("created") : c.dim("overwritten");
		writeln(`    ${G.ok} ${verb} ${r.path}`);
		renderDiff(r.diff);
		return;
	}

	if (toolName === "replace" || toolName === "insert") {
		const r = result as { path: string; diff: string; deleted?: boolean };
		const verb =
			toolName === "insert" ? "inserted" : r.deleted ? "deleted" : "replaced";
		writeln(`    ${G.ok} ${c.dim(verb)} ${r.path}`);
		renderDiff(r.diff);
		return;
	}

	if (toolName === "shell") {
		const r = result as {
			stdout: string;
			stderr: string;
			exitCode: number;
			success: boolean;
			timedOut: boolean;
		};

		const badge = r.timedOut
			? c.yellow("timeout")
			: r.success
				? c.green(`✔ ${r.exitCode}`)
				: c.red(`✖ ${r.exitCode}`);

		writeln(`    ${badge}`);

		const outLines = r.stdout ? r.stdout.split("\n") : [];
		const errLines = r.stderr ? r.stderr.split("\n") : [];

		// Show stdout (up to 20 lines)
		for (const line of outLines.slice(0, 20)) {
			writeln(`    ${c.dim("│")} ${line}`);
		}
		if (outLines.length > 20)
			writeln(`    ${c.dim(`│ … +${outLines.length - 20} lines`)}`);

		// Show stderr (up to 8 lines), only if non-empty
		for (const line of errLines.slice(0, 8)) {
			if (line.trim()) writeln(`    ${c.red("│")} ${c.dim(line)}`);
		}
		if (errLines.length > 8)
			writeln(`    ${c.red(`│ … +${errLines.length - 8} lines`)}`);
		return;
	}

	if (toolName === "subagent") {
		// Activity and tokens are streamed live.
		return;
	}

	// MCP tools — show content blocks
	if (toolName.startsWith("mcp_")) {
		const content = Array.isArray(result) ? result : [result];
		for (const block of (
			content as Array<{ type?: string; text?: string }>
		).slice(0, 5)) {
			if (block?.type === "text" && block.text) {
				const lines = block.text.split("\n").slice(0, 6);
				for (const l of lines) writeln(`    ${c.dim("│")} ${l}`);
			}
		}
		return;
	}

	// Generic fallback — one-line JSON summary
	const text = JSON.stringify(result);
	writeln(`    ${c.dim(text.length > 120 ? `${text.slice(0, 117)}…` : text)}`);
}

// ─── Diff rendering ───────────────────────────────────────────────────────────

function renderDiff(diff: string): void {
	if (!diff || diff === "(no changes)") return;
	for (const line of diff.split("\n")) {
		if (line.startsWith("+++") || line.startsWith("---")) {
			writeln(`    ${c.dim(line)}`);
		} else if (line.startsWith("+")) {
			writeln(`    ${c.green(line)}`);
		} else if (line.startsWith("-")) {
			writeln(`    ${c.red(line)}`);
		} else if (line.startsWith("@@")) {
			writeln(`    ${c.cyan(line)}`);
		} else {
			writeln(`    ${c.dim(line)}`);
		}
	}
}

// ─── Turn stream renderer ─────────────────────────────────────────────────────

export async function renderTurn(
	events: AsyncGenerator<TurnEvent>,
	spinner: Spinner,
): Promise<{
	inputTokens: number;
	outputTokens: number;
	contextTokens: number;
	newMessages: CoreMessage[];
}> {
	let inText = false;
	// Unprocessed raw text — only the portion from the last flush boundary
	// onward. Trimmed after each flush to keep memory constant.
	let rawBuffer = "";
	// Fence state at the start of rawBuffer — updated whenever we trim.
	let inFence = false;
	// ANSI-rendered characters waiting to be emitted one-by-one.
	let printQueue = "";
	// Next character index in printQueue to emit.
	let printPos = 0;
	// Handle for the active setTimeout ticker, or null if idle.
	let tickerHandle: ReturnType<typeof setTimeout> | null = null;

	let inputTokens = 0;
	let outputTokens = 0;
	let contextTokens = 0;
	let newMessages: CoreMessage[] = [];

	// Append rendered ANSI text to the print queue and start the ticker if
	// it is not already running.
	function enqueuePrint(ansi: string): void {
		printQueue += ansi;
		if (tickerHandle === null) {
			scheduleTick();
		}
	}

	// Emit one character from the print queue, then reschedule until drained.
	function tick(): void {
		tickerHandle = null;
		if (printPos < printQueue.length) {
			process.stdout.write(printQueue[printPos] as string);
			printPos++;
			scheduleTick();
		} else {
			// Queue fully drained — reclaim memory.
			printQueue = "";
			printPos = 0;
		}
	}

	function scheduleTick(): void {
		tickerHandle = setTimeout(tick, 8);
	}

	// Synchronously drain any remaining print queue — used when the turn ends
	// or a tool call interrupts the text stream.
	function drainQueue(): void {
		if (tickerHandle !== null) {
			clearTimeout(tickerHandle);
			tickerHandle = null;
		}
		if (printPos < printQueue.length) {
			process.stdout.write(printQueue.slice(printPos));
		}
		// Reclaim memory.
		printQueue = "";
		printPos = 0;
	}

	// Render and enqueue a slice of rawBuffer, then trim rawBuffer to only
	// retain the unprocessed tail. inFence is updated to reflect the new head.
	function renderAndTrim(end: number): void {
		const chunk = rawBuffer.slice(0, end);
		const rendered = renderChunk(chunk, inFence);
		inFence = rendered.inFence;
		enqueuePrint(rendered.output);
		rawBuffer = rawBuffer.slice(end);
	}

	// Flush complete chunks from rawBuffer. Strategy:
	//   1. If a \n\n boundary exists, flush everything up to and including it
	//      as one paragraph chunk — preserving blank-line spacing.
	//   2. Otherwise, flush any complete lines (\n) one at a time so that
	//      single-paragraph and list responses stream immediately rather than
	//      waiting for a blank line.
	// The unprocessed tail (partial line) stays in rawBuffer.
	function flushChunks(): void {
		// Prefer paragraph-level boundaries first.
		let boundary = rawBuffer.indexOf("\n\n");
		if (boundary !== -1) {
			// Flush everything up to and including the blank line.
			renderAndTrim(boundary + 2);
			// After trimming, there may be more boundaries — recurse.
			flushChunks();
			return;
		}
		// No blank line yet: flush any complete lines individually so content
		// appears immediately rather than waiting for the next blank line.
		boundary = rawBuffer.lastIndexOf("\n");
		if (boundary !== -1) {
			// Include the trailing \n so each line ends correctly.
			renderAndTrim(boundary + 1);
		}
	}

	// Render everything remaining in rawBuffer (the final partial chunk),
	// enqueue it, then drain the entire queue synchronously.
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
				// Abort errors (ctrl-c) are expected — show a quiet "interrupted" note
				// instead of a red error banner so the UX feels intentional.
				const isAbort =
					event.error.name === "AbortError" ||
					(event.error.name === "Error" &&
						event.error.message.toLowerCase().includes("abort"));
				if (isAbort) {
					writeln(`${G.warn} ${c.dim("interrupted")}`);
				} else {
					const msg = event.error.message.split("\n")[0] ?? event.error.message;
					writeln(`${G.err} ${c.red(msg)}`);
				}
				break;
			}
		}
	}

	return { inputTokens, outputTokens, contextTokens, newMessages };
}

// ─── Status bar ───────────────────────────────────────────────────────────────
// Rendered to stdout so it appears on the same stream as the prompt, guaranteeing
// it is flushed before readline draws the input line.
// Format:  model  provider  cwd  ⎇branch  ↑in ↓out

export function renderStatusBar(opts: {
	model: string;
	provider: string;
	cwd: string;
	gitBranch: string | null;
	sessionId: string;
	inputTokens: number;
	outputTokens: number;
	contextTokens: number;
	contextWindow: number | null;
	ralphMode?: boolean;
}): void {
	const cols = (process.stdout as NodeJS.WriteStream).columns ?? 80;

	// Build segments from right priority (rightmost items drop first)
	const left: string[] = [c.cyan(opts.model)];
	if (opts.provider && opts.provider !== "zen") left.push(c.dim(opts.provider));
	left.push(c.dim(opts.sessionId.slice(0, 8)));
	if (opts.ralphMode) left.push(c.magenta("↻ ralph"));

	const right: string[] = [];
	if (opts.inputTokens > 0 || opts.outputTokens > 0) {
		right.push(
			c.dim(`↑${fmtTokens(opts.inputTokens)} ↓${fmtTokens(opts.outputTokens)}`),
		);
	}
	if (opts.contextTokens > 0) {
		const ctxRaw = fmtTokens(opts.contextTokens);
		if (opts.contextWindow !== null) {
			const pct = Math.round((opts.contextTokens / opts.contextWindow) * 100);
			const ctxMax = fmtTokens(opts.contextWindow);
			const pctStr = `${pct}%`;
			const colored =
				pct >= 90
					? c.red(pctStr)
					: pct >= 75
						? c.yellow(pctStr)
						: c.dim(pctStr);
			right.push(c.dim(`ctx ${ctxRaw}/${ctxMax} `) + colored);
		} else {
			right.push(c.dim(`ctx ${ctxRaw}`));
		}
	}
	if (opts.gitBranch) right.push(c.dim(`⎇ ${opts.gitBranch}`));

	const cwdDisplay = opts.cwd;

	// Assemble: left  ·  cwd  ·  right (respects terminal width)
	const middle = c.dim(cwdDisplay);
	const sep = c.dim("  ");
	const full = [...left, middle, ...right.reverse()].join(sep);

	const visible = stripAnsi(full);

	const out = visible.length > cols ? truncateAnsi(full, cols - 1) : full;

	process.stdout.write(`${out}\n`);
}

// ─── Banner ───────────────────────────────────────────────────────────────────

export function renderBanner(model: string, cwd: string): void {
	writeln();
	writeln(`  ${c.cyan("mc")}  ${c.dim(`mini-coder · v${PACKAGE_VERSION}`)}`);
	writeln(`  ${c.dim(model)}  ${c.dim("·")}  ${c.dim(cwd)}`);
	writeln(`  ${c.dim("/help for commands  ·  ctrl+d to exit")}`);
	writeln();
}

// ─── Error / info helpers ─────────────────────────────────────────────────────

export function renderError(err: unknown): void {
	const msg = err instanceof Error ? err.message : String(err);
	writeln(`${G.err} ${c.red(msg)}`);
}

export function renderInfo(msg: string): void {
	writeln(`${G.info} ${c.dim(msg)}`);
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function fmtTokens(n: number): string {
	if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
	return String(n);
}

function commonPrefix(paths: string[]): string {
	const first = paths[0];
	if (!first) return "";
	const parts = first.split("/");
	let prefix = "";
	for (let i = 0; i < parts.length - 1; i++) {
		const candidate = `${parts.slice(0, i + 1).join("/")}/`;
		if (paths.every((p) => p.startsWith(candidate))) prefix = candidate;
		else break;
	}
	return prefix;
}

const ANSI_ESCAPE = "\u001b";

function stripAnsi(s: string): string {
	if (!s.includes(ANSI_ESCAPE)) return s;
	return s
		.split(ANSI_ESCAPE)
		.map((chunk, idx) => (idx === 0 ? chunk : chunk.replace(/^\[[0-9;]*m/, "")))
		.join("");
}

function truncateAnsi(s: string, maxLen: number): string {
	// Rough truncation — strip ANSI, find cut point, return prefix
	const plain = stripAnsi(s);
	if (plain.length <= maxLen) return s;
	// Find the index in the raw string that maps to maxLen visible chars
	let visible = 0;
	let i = 0;
	while (i < s.length && visible < maxLen - 1) {
		if (s[i] === "\x1B") {
			while (i < s.length && s[i] !== "m") i++;
		} else {
			visible++;
		}
		i++;
	}
	return s.slice(0, i) + c.dim("…");
}

// Re-export PREFIX alias for backward compat with other modules
export const PREFIX = {
	user: G.prompt,
	assistant: G.reply,
	tool: G.mcp,
	error: G.err,
	info: G.info,
	success: G.ok,
};
