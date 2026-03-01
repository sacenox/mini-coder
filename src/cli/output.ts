import { homedir } from "node:os";
import * as c from "yoctocolors";
import { terminal } from "./terminal-io.ts";

const HOME = homedir();
declare const __PACKAGE_VERSION__: string;
const PACKAGE_VERSION =
	typeof __PACKAGE_VERSION__ !== "undefined" ? __PACKAGE_VERSION__ : "unknown";

/** Replace the home directory prefix with `~` for display. */
export function tildePath(p: string): string {
	return p.startsWith(HOME) ? `~${p.slice(HOME.length)}` : p;
}

export function restoreTerminal(): void {
	terminal.restoreTerminal();
}

export function registerTerminalCleanup(): void {
	terminal.registerCleanup();
}

// ─── Primitives ───────────────────────────────────────────────────────────────

export function writeln(text = ""): void {
	terminal.stdoutWrite(`${text}\n`);
}

export function write(text: string): void {
	terminal.stdoutWrite(text);
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

// Re-export PREFIX alias for backward compat with other modules
export const PREFIX = {
	user: G.prompt,
	assistant: G.reply,
	tool: G.mcp,
	error: G.err,
	info: G.info,
	success: G.ok,
};

// ─── Banner ───────────────────────────────────────────────────────────────────

export function renderBanner(model: string, cwd: string): void {
	writeln();
	writeln(`  ${c.cyan("mc")}  ${c.dim(`mini-coder · v${PACKAGE_VERSION}`)}`);
	writeln(`  ${c.dim(model)}  ${c.dim("·")}  ${c.dim(cwd)}`);
	writeln(`  ${c.dim("/help for commands  ·  ctrl+d to exit")}`);
	writeln();
}

export function renderInfo(msg: string): void {
	writeln(`${G.info} ${c.dim(msg)}`);
}

// Re-exports
export { Spinner } from "./spinner.ts";
export { renderTurn } from "./stream-render.ts";
export {
	formatSubagentLabel,
	renderSubagentEvent,
	renderToolResult,
	renderToolCall,
	renderHook,
} from "./tool-render.ts";
export { renderStatusBar } from "./status-bar.ts";
export { renderError } from "./error-render.ts";
