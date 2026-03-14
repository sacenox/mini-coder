import * as c from "yoctocolors";
import { G } from "./output.ts";

function toolGlyph(name: string): string {
	if (name === "read") return G.read;
	if (name === "create" || name === "replace" || name === "insert")
		return G.write;
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

	if (name === "replace") {
		const range = a.endAnchor
			? c.dim(` ${a.startAnchor}–${a.endAnchor}`)
			: c.dim(` ${a.startAnchor}`);
		const verb =
			a.newContent === undefined || a.newContent === "" ? "delete" : "replace";
		return `${G.write} ${c.dim(verb)} ${c.bold(String(a.path ?? ""))}${range}`;
	}

	if (name === "insert") {
		return `${G.write} ${c.dim(`insert ${a.position ?? ""}`)} ${c.bold(String(a.path ?? ""))}${c.dim(` @ ${a.anchor}`)}`;
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
