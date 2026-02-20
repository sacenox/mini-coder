import { homedir } from "node:os";
import * as c from "yoctocolors";
import type { TurnEvent } from "../llm-api/types.ts";
import { renderMarkdown } from "./markdown.ts";

const HOME = homedir();

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
		// subagent result: { result: string, inputTokens, outputTokens }
		const r = result as {
			result?: string;
			inputTokens?: number;
			outputTokens?: number;
		};
		if (r.result) {
			const lines = r.result.split("\n");
			const preview = lines.slice(0, 8);
			for (const line of preview) writeln(`    ${c.dim("│")} ${line}`);
			if (lines.length > 8)
				writeln(`    ${c.dim(`│ … +${lines.length - 8} lines`)}`);
		}
		if (r.inputTokens || r.outputTokens) {
			// TODO: missing total unique context size in tokens
			writeln(`    ${c.dim(`↑${r.inputTokens ?? 0} ↓${r.outputTokens ?? 0}`)}`);
		}
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
	newMessages: import("../llm-api/turn.ts").CoreMessage[];
}> {
	let inText = false;
	// Full text accumulated so far — needed for correct markdown context
	// (e.g. knowing whether we're inside a fenced code block).
	let textBuffer = "";
	// Tracks how many characters of textBuffer have already been written to
	// stdout so we only write new content on each delta.
	let writtenLen = 0;
	let inputTokens = 0;
	let outputTokens = 0;
	let contextTokens = 0;
	let newMessages: import("../llm-api/turn.ts").CoreMessage[] = [];

	// Flush all completed lines (everything up to the last newline) through
	// renderMarkdown and write only the newly rendered portion to stdout.
	function flushLines(): void {
		const lastNl = textBuffer.lastIndexOf("\n");
		if (lastNl < writtenLen) return; // no new complete lines
		const fullRendered = renderMarkdown(textBuffer.slice(0, lastNl + 1));
		const alreadyRendered = renderMarkdown(textBuffer.slice(0, writtenLen));
		const newOutput = fullRendered.slice(alreadyRendered.length);
		if (newOutput) write(newOutput);
		writtenLen = lastNl + 1;
	}

	// Flush any remaining buffered text (including incomplete last line).
	function flushText(): void {
		if (writtenLen >= textBuffer.length) return;
		const fullRendered = renderMarkdown(textBuffer);
		const alreadyRendered = renderMarkdown(textBuffer.slice(0, writtenLen));
		const newOutput = fullRendered.slice(alreadyRendered.length);
		if (newOutput) write(newOutput);
		writtenLen = textBuffer.length;
	}

	for await (const event of events) {
		switch (event.type) {
			case "text-delta": {
				if (!inText) {
					spinner.stop();
					process.stdout.write(`${G.reply} `);
					inText = true;
				}
				textBuffer += event.delta;
				flushLines();
				break;
			}

			case "tool-call-start": {
				if (inText) {
					flushText();
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
					flushText();
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
					flushText();
					writeln();
					inText = false;
				}
				spinner.stop();
				const msg = event.error.message.split("\n")[0] ?? event.error.message;
				writeln(`${G.err} ${c.red(msg)}`);
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
}): void {
	const cols = (process.stdout as NodeJS.WriteStream).columns ?? 80;

	// Build segments from right priority (rightmost items drop first)
	const left: string[] = [c.cyan(opts.model)];
	if (opts.provider && opts.provider !== "zen") left.push(c.dim(opts.provider));
	left.push(c.dim(opts.sessionId.slice(0, 8)));

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
	writeln(`  ${c.cyan("mc")}  ${c.dim("mini-coder · v0.1.0")}`);
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
