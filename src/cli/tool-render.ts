import { homedir } from "node:os";
import * as c from "yoctocolors";
import { G, writeln } from "./output.ts";
import { buildToolCallLine } from "./tool-render-call.ts";
import { renderToolResult as renderResultImpl } from "./tool-render-result.ts";

const HOME = homedir();

export function renderToolCall(toolName: string, args: unknown): void {
	writeln(`  ${buildToolCallLine(toolName, args)}`);
}

export function renderHook(
	toolName: string,
	scriptPath: string,
	success: boolean,
): void {
	const short = scriptPath.replace(HOME, "~");
	if (success) {
		writeln(`    ${G.ok} ${c.dim(`hook post-${toolName}`)}`);
		return;
	}
	writeln(
		`    ${G.err} ${c.red(`hook post-${toolName} failed`)} ${c.dim(short)}`,
	);
}

export function renderToolResult(
	toolName: string,
	result: unknown,
	isError: boolean,
): void {
	renderResultImpl(toolName, result, isError);
}
