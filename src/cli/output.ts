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
import { LiveOutputBlock } from "./live-output.ts";
import { loadSkillsIndex } from "./skills.ts";
import { Spinner } from "./spinner.ts";
import { renderStatusBar } from "./status-bar.ts";
import { renderTurn } from "./stream-render.ts";
import { terminal } from "./terminal-io.ts";

const HOME = homedir();
declare const __PACKAGE_VERSION__: string;
const PACKAGE_VERSION =
	typeof __PACKAGE_VERSION__ !== "undefined" ? __PACKAGE_VERSION__ : null;

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

export function renderUserMessage(text: string): void {
	const lines = text.split("\n");
	if (lines.length === 0) {
		writeln(`${G.prompt}`);
		return;
	}

	writeln(`${G.prompt} ${lines[0] ?? ""}`);
	for (const line of lines.slice(1)) {
		writeln(`  ${line}`);
	}
}

// ─── Glyph vocabulary ─────────────────────────────────────────────────────────
// All from the 16-color ANSI palette — inherits terminal theme.

export const G = {
	prompt: c.green("›"),
	reply: c.cyan("◆"),
	search: c.yellow("?"),
	read: c.dim("←"),
	write: c.green("✎"),
	run: c.dim("$"),
	agent: c.cyan("⇢"),
	mcp: c.yellow("⚙"),
	ok: c.green("✔"),
	err: c.red("✖"),
	warn: c.yellow("!"),
	info: c.dim("·"),
};

export const PREFIX = {
	user: G.prompt,
	assistant: G.reply,
	tool: G.mcp,
	error: G.err,
	info: G.info,
	success: G.ok,
};

// ─── Error handling ───────────────────────────────────────────────────────────

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
	const title = PACKAGE_VERSION
		? `mini-coder · v${PACKAGE_VERSION}`
		: "mini-coder";
	writeln(`  ${c.cyan("mc")}  ${c.dim(title)}`);
	writeln(`  ${c.dim(model)}  ${c.dim("·")}  ${c.dim(cwd)}`);
	writeln(
		`  ${c.dim("/help for commands  ·  esc cancel  ·  ctrl+c/ctrl+d exit")}`,
	);

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

export class CliReporter implements AgentReporter {
	private spinner = new Spinner();
	private liveOutput = new LiveOutputBlock();

	private haltSpinner(): void {
		this.spinner.stop();
	}

	private haltSpinnerAndFlushLiveOutput(): void {
		this.spinner.stop();
		this.liveOutput.finish();
	}

	info(msg: string): void {
		this.haltSpinnerAndFlushLiveOutput();
		writeln(`${G.info} ${c.dim(msg)}`);
	}

	error(msg: string | Error, hint?: string): void {
		this.haltSpinnerAndFlushLiveOutput();
		if (typeof msg === "string") {
			renderError(msg, hint);
		} else {
			renderError(msg.message, hint);
		}
	}

	warn(msg: string): void {
		this.haltSpinnerAndFlushLiveOutput();
		writeln(`${G.warn} ${msg}`);
	}

	writeText(text: string): void {
		this.haltSpinnerAndFlushLiveOutput();
		writeln(text);
	}

	streamChunk(text: string): void {
		this.haltSpinner();
		this.liveOutput.append(text);
	}

	startSpinner(label?: string): void {
		this.spinner.start(label);
	}

	stopSpinner(): void {
		this.haltSpinner();
	}

	async renderTurn(
		events: AsyncIterable<TurnEvent>,
		opts?: { showReasoning?: boolean },
	): Promise<TurnResult> {
		this.liveOutput.finish();
		return renderTurn(events, this.spinner, opts);
	}

	renderStatusBar(data: StatusBarData): void {
		this.liveOutput.finish();
		renderStatusBar(data);
	}

	restoreTerminal(): void {
		restoreTerminal();
	}
}
