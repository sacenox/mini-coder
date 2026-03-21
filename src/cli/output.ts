import { homedir } from "node:os";
import * as c from "yoctocolors";
import { discoverContextFiles } from "../agent/context-files.ts";
import type {
  AgentReporter,
  StatusBarData,
  TurnResult,
} from "../agent/reporter.ts";
import { PACKAGE_VERSION } from "../internal/version.ts";
import type { TurnEvent } from "../llm-api/types.ts";
import { logError } from "../logging/context.ts";
import {
  getPreferredShowReasoning,
  getPreferredVerboseOutput,
} from "../session/db/index.ts";
import { parseAppError } from "./error-parse.ts";
import { loadSkillsIndex } from "./skills.ts";
import { Spinner } from "./spinner.ts";
import { renderStatusBar } from "./status-bar.ts";
import { renderTurn } from "./stream-render.ts";
import { terminal } from "./terminal-io.ts";

const HOME = homedir();

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

export function renderBanner(model: string, cwd: string): void {
  writeln();
  const title = PACKAGE_VERSION
    ? `mini-coder · v${PACKAGE_VERSION}`
    : "mini-coder";
  writeln(`  ${c.cyan("mc")}  ${c.dim(title)}`);
  writeln(`  ${c.dim(model)}  ${c.dim("·")}  ${c.dim(tildePath(cwd))}`);
  writeln(`  ${c.dim("/help for commands  ·  esc cancel  ·  ctrl+d exit")}`);

  const items: string[] = [];
  if (getPreferredShowReasoning()) items.push("reasoning: on");
  if (getPreferredVerboseOutput()) items.push("verbose: on");
  const contextFiles = discoverContextFiles(cwd);
  if (contextFiles.length > 0) items.push(...contextFiles);

  const skills = loadSkillsIndex(cwd);
  if (skills.size > 0)
    items.push(`${skills.size} skill${skills.size > 1 ? "s" : ""}`);

  if (items.length > 0) {
    writeln(`  ${c.dim(items.join("  ·  "))}`);
  }

  writeln();
}

// ─── CliReporter ──────────────────────────────────────────────────────────────

export class CliReporter implements AgentReporter {
  private spinner = new Spinner();

  constructor(private readonly quiet = false) {}

  info(msg: string): void {
    if (this.quiet) return;
    this.spinner.stop();
    writeln(`${G.info} ${c.dim(msg)}`);
  }

  /** Errors always render, even in quiet mode — they go to stderr and must be visible. */
  error(msg: string | Error, hint?: string): void {
    this.spinner.stop();
    if (typeof msg === "string") {
      renderError(msg, hint);
    } else {
      renderError(msg.message, hint);
    }
  }

  warn(msg: string): void {
    if (this.quiet) return;
    this.spinner.stop();
    writeln(`${G.warn} ${msg}`);
  }

  writeText(text: string): void {
    if (this.quiet) return;
    this.spinner.stop();
    writeln(text);
  }

  startSpinner(label?: string): void {
    if (this.quiet) return;
    this.spinner.start(label);
  }

  stopSpinner(): void {
    this.spinner.stop();
  }

  async renderTurn(
    events: AsyncIterable<TurnEvent>,
    opts?: { showReasoning?: boolean; verboseOutput?: boolean },
  ): Promise<TurnResult> {
    return renderTurn(events, this.spinner, {
      ...opts,
      quiet: this.quiet,
    });
  }

  renderStatusBar(data: StatusBarData): void {
    if (this.quiet) return;
    renderStatusBar(data);
  }

  restoreTerminal(): void {
    restoreTerminal();
  }
}
