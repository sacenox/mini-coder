import { homedir } from "node:os";
import * as c from "yoctocolors";
import { G, writeln } from "./output.ts";

const HOME = homedir();

function toolGlyph(name: string): string {
	if (name === "read") return G.read;
	if (name === "create" || name === "replace" || name === "insert")
		return G.write;
	if (name === "shell") return G.run;
	if (name === "subagent") return G.agent;
	if (name.startsWith("mcp_")) return G.mcp;
	return G.info;
}

function toolCallLine(
	name: string,
	args: unknown,
	_toolCallId?: string,
): string {
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
		return `${G.read} ${c.dim("read")} ${String(a.path ?? "")}${range}`;
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
		const cmd = String(a.command ?? "");
		const shortCmd = cmd.length > 72 ? `${cmd.slice(0, 69)}…` : cmd;
		return `${G.run} ${shortCmd}`;
	}
	if (name.startsWith("mcp_")) {
		return `${G.mcp} ${c.dim(name)}`;
	}
	return `${toolGlyph(name)} ${c.dim(name)}`;
}

export function renderToolCall(
	toolName: string,
	args: unknown,
	toolCallId?: string,
): void {
	writeln(`  ${toolCallLine(toolName, args, toolCallId)}`);
}
export function renderHook(
	toolName: string,
	scriptPath: string,
	success: boolean,
): void {
	const short = scriptPath.replace(HOME, "~");

	if (success) {
		writeln(`    ${G.ok} ${c.dim(`hook post-${toolName}`)}`);
	} else {
		writeln(
			`    ${G.err} ${c.red(`hook post-${toolName} failed`)} ${c.dim(short)}`,
		);
	}
}

function renderDiff(diff: string): void {
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

function formatShellBadge(r: {
	timedOut: boolean;
	success: boolean;
	exitCode: number;
}): string {
	return r.timedOut
		? c.yellow("timeout")
		: r.success
			? c.green(`✔ ${r.exitCode}`)
			: c.red(`✖ ${r.exitCode}`);
}

export function renderToolResult(
	toolName: string,
	result: unknown,
	isError: boolean,
	_toolCallId?: string,
): void {
	if (isError) {
		writeln(`    ${formatErrorBadge(result)}`);
		return;
	}

	if (toolName === "read") {
		const r = result as {
			path: string;
			line: number;
			totalLines: number;
			truncated: boolean;
			content?: string;
		};
		const linesReturned = r.content ? r.content.split("\n").length : 0;
		const endLine = linesReturned > 0 ? r.line + linesReturned - 1 : r.line;
		const range =
			r.line === 1 && endLine === r.totalLines
				? `${r.totalLines} lines`
				: `lines ${r.line}–${endLine} of ${r.totalLines}`;
		writeln(
			`    ${G.info} ${c.dim(`${r.path}  ${range}${r.truncated ? "  (truncated)" : ""}`)}`,
		);
		return;
	}

	if (toolName === "create") {
		const r = result as { path: string; diff: string; created: boolean };
		const verb = r.created ? c.green("created") : c.dim("overwritten");
		writeln(`    ${G.ok} ${verb} ${r.path}`);
		renderDiff(r.diff);
		return;
	}

	if (toolName === "replace" || toolName === "insert") {
		const r = result as { path: string; diff: string; deleted?: boolean };
		const verb =
			toolName === "insert" ? "inserted" : r.deleted ? "deleted" : "replaced";
		writeln(`    ${G.ok} ${c.dim(verb)} ${r.path}`);
		renderDiff(r.diff);
		return;
	}

	if (toolName === "shell") {
		const r = result as {
			stdout: string;
			stderr: string;
			exitCode: number;
			success: boolean;
			timedOut: boolean;
		};

		const badge = formatShellBadge(r);

		writeln(`    ${badge}`);

		const outLines = r.stdout ? r.stdout.split("\n") : [];
		const errLines = r.stderr ? r.stderr.split("\n") : [];

		// Show stdout (up to 20 lines)
		for (const line of outLines.slice(0, 20)) {
			writeln(`    ${c.dim("│")} ${line}`);
		}
		if (outLines.length > 20)
			writeln(`    ${c.dim(`│ … +${outLines.length - 20} lines`)}`);

		// Show stderr (up to 8 lines), only if non-empty
		for (const line of errLines.slice(0, 8)) {
			if (line.trim()) writeln(`    ${c.red("│")} ${c.dim(line)}`);
		}
		if (errLines.length > 8)
			writeln(`    ${c.red(`│ … +${errLines.length - 8} lines`)}`);
		return;
	}

	if (toolName === "subagent") {
		const r = result as {
			inputTokens?: number;
			outputTokens?: number;
			agentName?: string;
		};
		const label = r.agentName ? ` ${c.dim(c.cyan(`[@${r.agentName}]`))}` : "";
		writeln(
			`    ${G.agent}${label} ${c.dim(`subagent done (${r.inputTokens ?? 0}in / ${r.outputTokens ?? 0}out tokens)`)}`,
		);

		return;
	}

	if (toolName === "readSkill") {
		const r = result as {
			skill?: {
				name?: string;
				description?: string;
				source?: "local" | "global";
			};
		};
		if (!r.skill) {
			writeln(`    ${G.info} ${c.dim("skill-auto-load miss")}`);
			return;
		}
		const name = r.skill.name ?? "(unknown)";
		const source = r.skill.source ?? "unknown";
		const description = r.skill.description?.trim();
		writeln(
			`    ${G.info} ${c.dim(`skill-auto-loaded name=${name} source=${source}${description ? ` description=${JSON.stringify(description)}` : ""}`)}`,
		);
		return;
	}

	if (toolName === "webSearch") {
		const r = result as {
			results?: Array<{ title?: string; url?: string; score?: number }>;
		};
		if (Array.isArray(r?.results)) {
			if (r.results.length === 0) {
				writeln(`    ${G.info} ${c.dim("no results")}`);
				return;
			}

			for (const item of r.results.slice(0, 5)) {
				const title = (item.title?.trim() || item.url || "(untitled)").replace(
					/\s+/g,
					" ",
				);
				const score =
					typeof item.score === "number"
						? c.dim(` (${item.score.toFixed(2)})`)
						: "";
				writeln(`    ${c.dim("•")} ${title}${score}`);
				if (item.url) writeln(`      ${c.dim(item.url)}`);
			}

			if (r.results.length > 5) {
				writeln(`    ${c.dim(`  +${r.results.length - 5} more`)}`);
			}
			return;
		}
	}

	if (toolName === "webContent") {
		const r = result as {
			results?: Array<{ url?: string; title?: string; text?: string }>;
		};
		if (Array.isArray(r?.results)) {
			if (r.results.length === 0) {
				writeln(`    ${G.info} ${c.dim("no pages")}`);
				return;
			}

			for (const item of r.results.slice(0, 3)) {
				const title = (item.title?.trim() || item.url || "(untitled)").replace(
					/\s+/g,
					" ",
				);
				writeln(`    ${c.dim("•")} ${title}`);
				if (item.url) writeln(`      ${c.dim(item.url)}`);
				const preview = (item.text ?? "").replace(/\s+/g, " ").trim();
				if (preview) {
					const trimmed =
						preview.length > 220 ? `${preview.slice(0, 217)}…` : preview;
					writeln(`      ${c.dim(trimmed)}`);
				}
			}

			if (r.results.length > 3) {
				writeln(`    ${c.dim(`  +${r.results.length - 3} more`)}`);
			}
			return;
		}
	}

	// MCP tools — show content blocks
	if (toolName.startsWith("mcp_")) {
		const content = Array.isArray(result) ? result : [result];
		for (const block of (
			content as Array<{ type?: string; text?: string }>
		).slice(0, 5)) {
			if (block?.type === "text" && block.text) {
				const lines = block.text.split("\n").slice(0, 6);
				for (const l of lines) writeln(`    ${c.dim("│")} ${l}`);
			}
		}
		return;
	}

	// Generic fallback — one-line JSON summary
	const text = JSON.stringify(result);
	writeln(`    ${c.dim(text.length > 120 ? `${text.slice(0, 117)}…` : text)}`);
}
