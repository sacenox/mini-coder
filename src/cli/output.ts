import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import * as c from "yoctocolors";
import { loadAgents } from "./agents.ts";
import { loadCustomCommands } from "./custom-commands.ts";
import { loadSkillsIndex } from "./skills.ts";
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
	search: c.yellow("?"), // search (shell grep/glob)
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

/** Discover which context/config files exist for display in the banner. */
function discoverContextFiles(cwd: string): string[] {
	const found: string[] = [];
	const globalDir = join(HOME, ".agents");
	const candidates: [string, string][] = [
		[join(globalDir, "AGENTS.md"), "~/.agents/AGENTS.md"],
		[join(globalDir, "CLAUDE.md"), "~/.agents/CLAUDE.md"],
		[join(cwd, ".agents", "AGENTS.md"), ".agents/AGENTS.md"],
		[join(cwd, "CLAUDE.md"), "CLAUDE.md"],
		[join(cwd, "AGENTS.md"), "AGENTS.md"],
	];
	for (const [abs, label] of candidates) {
		if (existsSync(abs)) found.push(label);
	}
	return found;
}

export function renderBanner(model: string, cwd: string): void {
	writeln();
	writeln(`  ${c.cyan("mc")}  ${c.dim(`mini-coder · v${PACKAGE_VERSION}`)}`);
	writeln(`  ${c.dim(model)}  ${c.dim("·")}  ${c.dim(cwd)}`);
	writeln(
		`  ${c.dim("/help for commands  ·  esc cancel  ·  ctrl+c/ctrl+d exit")}`,
	);

	// Show discovered configs and context
	const items: string[] = [];
	const contextFiles = discoverContextFiles(cwd);
	if (contextFiles.length > 0) items.push(...contextFiles);

	const agents = loadAgents(cwd);
	if (agents.size > 0)
		items.push(`${agents.size} agent${agents.size > 1 ? "s" : ""}`);

	const skills = loadSkillsIndex(cwd);
	if (skills.size > 0)
		items.push(`${skills.size} skill${skills.size > 1 ? "s" : ""}`);

	const commands = loadCustomCommands(cwd);
	if (commands.size > 0)
		items.push(`${commands.size} custom cmd${commands.size > 1 ? "s" : ""}`);

	if (items.length > 0) {
		writeln(`  ${c.dim(items.join("  ·  "))}`);
	}

	writeln();
}

export function renderInfo(msg: string): void {
	writeln(`${G.info} ${c.dim(msg)}`);
}

export { renderError } from "./error-render.ts";
// Re-exports
export { Spinner } from "./spinner.ts";
export { renderStatusBar } from "./status-bar.ts";
export { renderTurn } from "./stream-render.ts";
export { renderHook } from "./tool-render.ts";
