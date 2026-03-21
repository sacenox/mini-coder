import * as c from "yoctocolors";
import type { StatusBarData } from "../agent/reporter.ts";
import { stripAnsi } from "../internal/ansi.ts";
import { truncateText } from "../internal/text.ts";
import { terminal } from "./terminal-io.ts";

const STATUS_SEP = c.dim("  ·  ");

function fmtTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function buildContextSegment(opts: {
  contextTokens: number;
  contextWindow: number | null;
}): string | null {
  if (opts.contextTokens <= 0) return null;
  if (opts.contextWindow === null) {
    return c.dim(`ctx ${fmtTokens(opts.contextTokens)}`);
  }

  const pct = Math.round((opts.contextTokens / opts.contextWindow) * 100);
  const pctStr = `${pct}%`;
  let pctColored = c.dim(pctStr);
  if (pct >= 90) pctColored = c.red(pctStr);
  else if (pct >= 75) pctColored = c.yellow(pctStr);
  return (
    c.dim(
      `ctx ${fmtTokens(opts.contextTokens)}/${fmtTokens(opts.contextWindow)} `,
    ) + pctColored
  );
}

function renderStatusLine(segments: string[]): string {
  return segments.join(STATUS_SEP);
}

export function buildStatusBarSignature(opts: StatusBarData): string {
  return JSON.stringify({
    model: opts.model,
    cwd: opts.cwd,
    gitBranch: opts.gitBranch,
    sessionId: opts.sessionId,
    inputTokens: opts.inputTokens,
    outputTokens: opts.outputTokens,
    contextTokens: opts.contextTokens,
    contextWindow: opts.contextWindow,
    thinkingEffort: opts.thinkingEffort ?? null,
    showReasoning: opts.showReasoning ?? false,
  });
}

function fitStatusSegments(
  required: string[],
  optional: string[],
  cols: number,
): string {
  const fittedOptional = [...optional];
  let line = renderStatusLine([...required, ...fittedOptional]);

  while (stripAnsi(line).length > cols && fittedOptional.length > 0) {
    fittedOptional.pop();
    line = renderStatusLine([...required, ...fittedOptional]);
  }

  if (stripAnsi(line).length <= cols) return line;

  const plainRequired = required.map((segment) => stripAnsi(segment));
  const sepLen = stripAnsi(STATUS_SEP).length;
  const fixedPrefix = plainRequired[0] ?? "";
  if (plainRequired.length <= 1) return truncateText(fixedPrefix, cols);

  const maxTailLen = Math.max(8, cols - fixedPrefix.length - sepLen);
  const truncatedTail = truncateText(plainRequired[1] ?? "", maxTailLen);
  return `${required[0]}${STATUS_SEP}${c.dim(truncatedTail)}`;
}

export function renderStatusBar(opts: StatusBarData): void {
  const cols = Math.max(20, terminal.stdoutColumns || 80);
  const required = [c.cyan(opts.model), c.dim(`#${opts.sessionId}`)];
  const optional: string[] = [];

  if (opts.thinkingEffort) optional.push(c.dim(`✦ ${opts.thinkingEffort}`));
  if (opts.gitBranch) optional.push(c.dim(`⎇ ${opts.gitBranch}`));

  if (opts.inputTokens > 0 || opts.outputTokens > 0) {
    optional.push(
      c.dim(
        `tok ${fmtTokens(opts.inputTokens)}/${fmtTokens(opts.outputTokens)}`,
      ),
    );
  }

  const contextSegment = buildContextSegment({
    contextTokens: opts.contextTokens,
    contextWindow: opts.contextWindow,
  });
  if (contextSegment) optional.push(contextSegment);

  optional.push(c.dim(opts.cwd));

  const out = fitStatusSegments(required, optional, cols);
  terminal.stdoutWrite(`${out}\n`);
}
