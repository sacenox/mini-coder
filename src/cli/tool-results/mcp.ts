import * as c from "yoctocolors";
import { writeln } from "../output.ts";

export function renderMcpResult(result: unknown): boolean {
	const content = Array.isArray(result) ? result : [result];
	for (const block of (
		content as Array<{ type?: string; text?: string }>
	).slice(0, 5)) {
		if (block?.type === "text" && block.text) {
			const lines = block.text.split("\n").slice(0, 6);
			for (const line of lines) writeln(`    ${c.dim("│")} ${line}`);
		}
	}
	return true;
}
