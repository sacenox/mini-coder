import * as c from "yoctocolors";
import { writeln } from "./output.ts";

const MAX_DIFF_PREVIEW_LINES = 24;

function colorizeDiffLine(line: string): string {
	if (line.startsWith("+++") || line.startsWith("---")) return c.dim(line);
	if (line.startsWith("+")) return c.green(line);
	if (line.startsWith("-")) return c.red(line);
	if (line.startsWith("@@")) return c.cyan(line);
	return c.dim(line);
}

export function renderDiff(diff: string): void {
	if (!diff || diff === "(no changes)") return;

	const normalized = diff.replace(/[\r\n]+$/, "");
	if (!normalized) return;

	const lines = normalized.split("\n");
	const shown = lines.slice(0, MAX_DIFF_PREVIEW_LINES);
	for (const line of shown) {
		writeln(`    ${colorizeDiffLine(line)}`);
	}
	if (lines.length > shown.length) {
		writeln(
			`    ${c.dim(`… +${lines.length - shown.length} more diff lines`)}`,
		);
	}
}

export function writePreviewLines(opts: {
	label: string;
	value: string;
	lineColor: (input: string) => string;
	maxLines: number;
}): void {
	if (!opts.value.trim()) return;
	const lines = opts.value.split("\n");
	writeln(`    ${c.dim(opts.label)} ${c.dim(`(${lines.length} lines)`)}`);
	for (const line of lines.slice(0, opts.maxLines)) {
		writeln(`    ${opts.lineColor("│")} ${line}`);
	}
	if (lines.length > opts.maxLines) {
		writeln(
			`    ${opts.lineColor("│")} ${c.dim(`… +${lines.length - opts.maxLines} lines`)}`,
		);
	}
}
