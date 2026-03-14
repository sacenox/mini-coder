import * as c from "yoctocolors";
import { G, writeln } from "../output.ts";

export function renderReadResult(result: unknown): boolean {
	const r = result as {
		path: string;
		line: number;
		totalLines: number;
		truncated: boolean;
		content?: string;
	};
	if (!r || typeof r.path !== "string") return false;

	const linesReturned = r.content ? r.content.split("\n").length : 0;
	const endLine = linesReturned > 0 ? r.line + linesReturned - 1 : r.line;
	const range =
		r.line === 1 && endLine === r.totalLines
			? `${r.totalLines} lines`
			: `lines ${r.line}–${endLine} of ${r.totalLines}`;
	writeln(
		`    ${G.info} ${c.dim(`${r.path}  ${range}${r.truncated ? "  (truncated)" : ""}`)}`,
	);
	return true;
}
