import * as c from "yoctocolors";
import { G, tildePath, writeln } from "./output.ts";
import { renderToolResultByName } from "./tool-result-renderers.ts";

function toolGlyph(name: string): string {
	if (name === "shell") return G.run;
	if (name === "readSkill") return G.read;
	if (name === "listSkills") return G.search;
	if (name === "webSearch") return G.search;
	if (name === "webContent") return G.read;
	if (name.startsWith("mcp_")) return G.mcp;
	return G.info;
}

/** Resolve glyph for well-known shell commands (lazy to avoid init-order issues). */
function shellCmdGlyph(cmd: string): string {
	switch (cmd) {
		case "cat":
		case "head":
		case "tail":
		case "ls":
		case "wc":
			return G.read;
		case "grep":
		case "find":
			return G.search;
		case "mc-edit":
		case "sed":
		case "rm":
		case "mkdir":
		case "cp":
		case "mv":
		case "touch":
			return G.write;
		case "git":
		case "bun":
		case "echo":
			return G.run;
		default:
			return G.run;
	}
}

/**
 * Strip a leading `cd <path> &&` prefix from a shell command string.
 * Returns the directory (tilde-abbreviated) and the remaining command.
 */
function parseShellCdPrefix(cmd: string): {
	cwd: string | null;
	rest: string;
} {
	const match = cmd.match(/^cd\s+(\S+)\s*&&\s*/);
	if (!match) return { cwd: null, rest: cmd };
	const rawPath = match[1] ?? "";
	const rest = cmd.slice(match[0].length).trim();
	return { cwd: tildePath(rawPath), rest: rest || cmd };
}

/**
 * Extract the first command word from a shell string,
 * skipping inline env vars like `FOO=bar cmd ...`.
 */
function extractFirstCommand(cmd: string): string {
	const tokens = cmd.split(/\s+/);
	for (const token of tokens) {
		if (token.includes("=") && !token.startsWith("-")) continue;
		return token;
	}
	return tokens[0] ?? "";
}

function truncate(s: string, max: number): string {
	return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function formatShellCallLine(cmd: string): string {
	const { cwd, rest } = parseShellCdPrefix(cmd);
	const firstCmd = extractFirstCommand(rest);
	const glyph = shellCmdGlyph(firstCmd);
	const cwdSuffix = cwd ? ` ${c.dim(`in ${cwd}`)}` : "";
	const display = truncate(rest, 80);
	return `${glyph} ${display}${cwdSuffix}`;
}

export function buildToolCallLine(name: string, args: unknown): string {
	const a =
		args && typeof args === "object" ? (args as Record<string, unknown>) : {};

	if (name === "shell") {
		const cmd = String(a.command ?? "").trim();
		if (!cmd) return `${G.run} ${c.dim("shell")}`;
		return formatShellCallLine(cmd);
	}

	if (name === "listSkills") {
		return `${G.search} ${c.dim("list skills")}`;
	}

	if (name === "readSkill") {
		const skillName = typeof a.name === "string" ? a.name : "";
		return `${G.read} ${c.dim("read skill")}${skillName ? ` ${skillName}` : ""}`;
	}

	if (name === "webSearch") {
		const query = typeof a.query === "string" ? a.query : "";
		const short = query.length > 60 ? `${query.slice(0, 57)}…` : query;
		return `${G.search} ${c.dim("search")}${short ? ` ${short}` : ""}`;
	}

	if (name === "webContent") {
		const urls = Array.isArray(a.urls) ? a.urls : [];
		const label =
			urls.length === 1
				? String(urls[0])
				: `${urls.length} url${urls.length !== 1 ? "s" : ""}`;
		const short = label.length > 60 ? `${label.slice(0, 57)}…` : label;
		return `${G.read} ${c.dim("fetch")} ${short}`;
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

interface ToolResultRenderOptions {
	verboseOutput?: boolean;
}

export function renderToolResult(
	toolName: string,
	result: unknown,
	isError: boolean,
	opts?: ToolResultRenderOptions,
): void {
	if (isError) {
		writeln(`    ${formatErrorBadge(result)}`);
		return;
	}

	if (renderToolResultByName(toolName, result, opts)) {
		return;
	}

	const text = JSON.stringify(result);
	if (opts?.verboseOutput || text.length <= 120) {
		writeln(`    ${c.dim(text)}`);
		return;
	}
	writeln(`    ${c.dim(`${text.slice(0, 117)}…`)}`);
}
