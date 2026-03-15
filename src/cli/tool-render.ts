import { homedir } from "node:os";
import * as c from "yoctocolors";
import { G, writeln } from "./output.ts";
import { renderToolResultByName } from "./tool-result-renderers.ts";

const HOME = homedir();

// ─── Tool call line rendering ─────────────────────────────────────────────────

function toolGlyph(name: string): string {
	if (name === "read") return G.read;
	if (name === "create") return G.write;
	if (name === "shell") return G.run;
	if (name === "subagent") return G.agent;
	if (name.startsWith("mcp_")) return G.mcp;
	return G.info;
}

export function buildToolCallLine(name: string, args: unknown): string {
	const a =
		args && typeof args === "object" ? (args as Record<string, unknown>) : {};

	if (name === "subagent") {
		const prompt = typeof a.prompt === "string" ? a.prompt : "";
		const short = prompt.length > 60 ? `${prompt.slice(0, 57)}…` : prompt;
		const agentName =
			typeof a.agentName === "string" && a.agentName ? a.agentName : "";
		const label = agentName ? ` ${c.dim(c.cyan(`[@${agentName}]`))}` : "";
		return `${G.agent}${label} ${c.dim("—")} ${short}`;
	}

	if (name === "read") {
		const line = Number.isFinite(a.line as number) ? Number(a.line) : null;
		const count = Number.isFinite(a.count as number) ? Number(a.count) : null;
		const range =
			line || count ? c.dim(`:${line ?? 1}${count ? `+${count}` : ""}`) : "";
		const path =
			typeof a.path === "string" && a.path.length > 0 ? a.path : null;
		return `${G.read} ${c.dim("read")}${path ? ` ${path}${range}` : ""}`;
	}

	if (name === "create") {
		return `${G.write} ${c.dim("create")} ${c.bold(String(a.path ?? ""))}`;
	}

	if (name === "shell") {
		const cmd = String(a.command ?? "").trim();
		if (!cmd) return `${G.run} ${c.dim("shell")}`;
		const shortCmd = cmd.length > 72 ? `${cmd.slice(0, 69)}…` : cmd;
		return `${G.run} ${shortCmd}`;
	}

	if (name.startsWith("mcp_")) {
		return `${G.mcp} ${c.dim(name)}`;
	}

	return `${toolGlyph(name)} ${c.dim(name)}`;
}

export function renderToolCall(toolName: string, args: unknown): void {
	writeln(`  ${buildToolCallLine(toolName, args)}`);
}

// ─── Tool result rendering ────────────────────────────────────────────────────

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

// ─── Hook rendering ───────────────────────────────────────────────────────────

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
