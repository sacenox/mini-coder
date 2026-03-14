import * as c from "yoctocolors";
import { terminal } from "./terminal-io.ts";

const ANSI_ESCAPE = "\u001b";
const STATUS_SEP = c.dim("  ·  ");

function stripAnsi(s: string): string {
	if (!s.includes(ANSI_ESCAPE)) return s;
	return s
		.split(ANSI_ESCAPE)
		.map((chunk, idx) => (idx === 0 ? chunk : chunk.replace(/^\[[0-9;]*m/, "")))
		.join("");
}

function truncatePlainText(value: string, maxLen: number): string {
	if (value.length <= maxLen) return value;
	if (maxLen <= 1) return "…";
	return `${value.slice(0, maxLen - 1)}…`;
}

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
	const pctColored =
		pct >= 90 ? c.red(pctStr) : pct >= 75 ? c.yellow(pctStr) : c.dim(pctStr);
	return (
		c.dim(
			`ctx ${fmtTokens(opts.contextTokens)}/${fmtTokens(opts.contextWindow)} `,
		) + pctColored
	);
}

function renderStatusLine(segments: string[]): string {
	return segments.join(STATUS_SEP);
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
	if (plainRequired.length <= 1) return truncatePlainText(fixedPrefix, cols);

	const maxTailLen = Math.max(8, cols - fixedPrefix.length - sepLen);
	const truncatedTail = truncatePlainText(plainRequired[1] ?? "", maxTailLen);
	return `${required[0]}${STATUS_SEP}${c.dim(truncatedTail)}`;
}

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
	thinkingEffort?: string | null;
	activeAgent?: string | null;
	showReasoning?: boolean;
}): void {
	const cols = Math.max(20, terminal.stdoutColumns || 80);
	const required = [c.cyan(opts.model), c.dim(opts.cwd)];
	const optional: string[] = [];

	if (opts.activeAgent) optional.push(c.green(`@${opts.activeAgent}`));
	if (opts.thinkingEffort) optional.push(c.dim(`✦ ${opts.thinkingEffort}`));
	if (opts.showReasoning) optional.push(c.dim("reasoning"));
	if (opts.provider && opts.provider !== "zen") {
		optional.push(c.dim(opts.provider));
	}
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

	optional.push(c.dim(`#${opts.sessionId.slice(0, 8)}`));

	const out = fitStatusSegments(required, optional, cols);
	terminal.stdoutWrite(`${out}\n`);
}
