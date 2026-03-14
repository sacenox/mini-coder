import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import * as c from "yoctocolors";
import type {
	AgentReporter,
	StatusBarData,
	TurnResult,
} from "../agent/reporter.ts";
import type { TurnEvent } from "../llm-api/types.ts";
import { loadAgents } from "./agents.ts";
import { loadCustomCommands } from "./custom-commands.ts";
import { logError } from "./error-log.ts";
import { parseAppError } from "./error-parse.ts";
import { Spinner } from "./spinner.ts";
import { renderStatusBar } from "./status-bar.ts";
import { renderTurn } from "./stream-render.ts";
import { loadSkillsIndex } from "./skills.ts";
import { terminal } from "./terminal-io.ts";
import { renderHook } from "./tool-render.ts";

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

// ─── Error handling ───────────────────────────────────────────────────────────

/**
 * Thrown after an error has already been rendered to the terminal.
 * Outer catch blocks can check for this to avoid re-displaying the same error.
 */
export class RenderedError extends Error {
	public readonly cause: unknown;
	constructor(cause: unknown) {
		super("already rendered");
		this.name = "RenderedError";
		this.cause = cause;
	}
}

export function renderError(err: unknown, context = "render"): void {
	logError(err, context);
	const parsed = parseAppError(err);
	writeln(`${G.err} ${c.red(parsed.headline)}`);
	if (parsed.hint) {
		writeln(`  ${c.dim(parsed.hint)}`);
	}
}

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

// ─── CliReporter ──────────────────────────────────────────────────────────────
// Interactive terminal reporter — wraps all output primitives for agent use.

export class CliReporter implements AgentReporter {
	private spinner = new Spinner();

	info(msg: string): void {
		this.spinner.stop();
		writeln(`${G.info} ${c.dim(msg)}`);
	}

	error(msg: string | Error, hint?: string): void {
		this.spinner.stop();
		if (typeof msg === "string") {
			renderError(msg, hint);
		} else {
			renderError(msg.message, hint);
		}
	}

	warn(msg: string): void {
		this.spinner.stop();
		writeln(`${G.warn} ${msg}`);
	}

	writeText(text: string): void {
		this.spinner.stop();
		writeln(text);
	}

	streamChunk(text: string): void {
		this.spinner.stop();
		write(text);
	}

	startSpinner(label?: string): void {
		this.spinner.start(label);
	}

	stopSpinner(): void {
		this.spinner.stop();
	}

	renderSubState(label: string): void {
		this.spinner.stop();
		writeln(`    ${G.info} ${c.dim(label)}`);
		this.spinner.start();
	}

	async renderTurn(
		events: AsyncIterable<TurnEvent>,
		opts?: { showReasoning?: boolean },
	): Promise<TurnResult> {
		return renderTurn(events, this.spinner, opts);
	}

	renderStatusBar(data: StatusBarData): void {
		renderStatusBar(data);
	}

	renderHook(toolName: string, scriptPath: string, success: boolean): void {
		this.spinner.stop();
		renderHook(toolName, scriptPath, success);
	}

	restoreTerminal(): void {
		restoreTerminal();
	}
}
