import * as c from "yoctocolors";
import { G, writeln } from "./output.ts";
import { renderToolResultByName } from "./tool-result-renderers.ts";

function toolGlyph(name: string): string {
	if (name === "shell") return G.run;
	if (name === "subagent") return G.agent;
	if (name === "readSkill") return G.read;
	if (name === "listSkills") return G.search;
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

	if (name === "shell") {
		const cmd = String(a.command ?? "").trim();
		if (!cmd) return `${G.run} ${c.dim("shell")}`;
		const shortCmd = cmd.length > 72 ? `${cmd.slice(0, 69)}…` : cmd;
		return `${G.run} ${shortCmd}`;
	}

	if (name === "listSkills") {
		return `${G.search} ${c.dim("list skills")}`;
	}

	if (name === "readSkill") {
		const skillName = typeof a.name === "string" ? a.name : "";
		return `${G.read} ${c.dim("read skill")}${skillName ? ` ${skillName}` : ""}`;
	}

	if (name.startsWith("mcp_")) {
		return `${G.mcp} ${c.dim(name)}`;
	}

	return `${toolGlyph(name)} ${c.dim(name)}`;
}

export function renderToolCall(toolName: string, args: unknown): void {
	writeln(`  ${buildToolCallLine(toolName, args)}`);
}

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
