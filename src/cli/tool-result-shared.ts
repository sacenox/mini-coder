import * as c from "yoctocolors";
import { writeln } from "./output.ts";

export function renderDiff(diff: string): void {
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
