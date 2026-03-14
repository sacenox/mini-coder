import * as c from "yoctocolors";
import { G, writeln } from "./output.ts";
import { renderToolResultByName } from "./tool-result-handlers.ts";

function formatErrorBadge(result: unknown): string {
	const msg =
		typeof result === "string"
			? result
			: result instanceof Error
				? result.message
				: JSON.stringify(result);
	const oneLiner = msg.split("\n")[0] ?? msg;
	return `${G.err} ${c.red(oneLiner)}`;
}

export function renderToolResult(
	toolName: string,
	result: unknown,
	isError: boolean,
): void {
	if (isError) {
		writeln(`    ${formatErrorBadge(result)}`);
		return;
	}

	if (renderToolResultByName(toolName, result)) {
		return;
	}

	const text = JSON.stringify(result);
	writeln(`    ${c.dim(text.length > 120 ? `${text.slice(0, 117)}…` : text)}`);
}
