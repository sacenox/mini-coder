import { homedir } from "node:os";
import * as c from "yoctocolors";
import type { TurnEvent } from "../llm-api/types.ts";
import { logError } from "./error-log.ts";
import { parseAppError } from "./error-parse.ts";
import { G, writeln } from "./output.ts";

const HOME = homedir();

/** Strip the `linenum:hash| ` prefix that hashline-formatted tool outputs include. */
export function stripHashlinePrefix(text: string): string {
	return text.replace(/^\d+:[0-9a-f]{2}\| /, "");
}

function commonPrefix(paths: string[]): string {
	const first = paths[0];
	if (!first) return "";
	const parts = first.split("/");
	let prefix = "";
	for (let i = 0; i < parts.length - 1; i++) {
		const candidate = `${parts.slice(0, i + 1).join("/")}/`;
		if (paths.every((p) => p.startsWith(candidate))) prefix = candidate;
		else break;
	}
	return prefix;
}

export function toolGlyph(name: string): string {
	if (name === "glob" || name === "grep") return G.search;
	if (name === "read") return G.read;
	if (name === "create" || name === "replace" || name === "insert")
		return G.write;
	if (name === "shell") return G.run;
	if (name === "subagent") return G.agent;
	if (name.startsWith("mcp_")) return G.mcp;
	return G.info;
}

export function toolCallLine(name: string, args: unknown): string {
	const a =
		args && typeof args === "object" ? (args as Record<string, unknown>) : {};

	if (name === "glob") {
		const pattern = String(a.pattern ?? "");
		const cwd = a.cwd ? String(a.cwd) : "";
		return `${G.search} ${c.dim("glob")} ${c.bold(pattern)}${cwd ? c.dim(` in ${cwd}`) : ""}`;
	}
	if (name === "grep") {
		const flags = [
			a.include ? String(a.include) : null,
			a.caseSensitive === false ? "i" : null,
		]
			.filter(Boolean)
			.join(" ");
		const pattern = String(a.pattern ?? "");
		return `${G.search} ${c.dim("grep")} ${c.bold(pattern)}${flags ? c.dim(`  ${flags}`) : ""}`;
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
		return `${G.run} ${c.dim("$")} ${shortCmd}`;
	}
	if (name === "subagent") {
		const prompt = String(a.prompt ?? "");
		const shortPrompt = prompt.length > 60 ? `${prompt.slice(0, 57)}…` : prompt;
		return `${G.agent} ${c.dim("subagent")} ${c.dim(shortPrompt)}`;
	}
	if (name.startsWith("mcp_")) {
		return `${G.mcp} ${c.dim(name)}`;
	}
	return `${toolGlyph(name)} ${c.dim(name)}`;
}

export function renderToolCall(toolName: string, args: unknown): void {
	writeln(`  ${toolCallLine(toolName, args)}`);
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

export function renderToolResultInline(
	toolName: string,
	result: unknown,
	isError: boolean,
	indent: string,
): void {
	if (isError) {
		const msg =
			typeof result === "string"
				? result
				: result instanceof Error
					? result.message
					: JSON.stringify(result);
		const oneLiner = msg.split("\n")[0] ?? msg;
		writeln(`${indent}${G.err} ${c.red(oneLiner)}`);
		return;
	}

	if (toolName === "glob") {
		const r = result as { files: string[]; truncated: boolean };
		const n = r.files.length;
		writeln(
			`${indent}${G.info} ${c.dim(n === 0 ? "no matches" : `${n} file${n === 1 ? "" : "s"}${r.truncated ? " (capped)" : ""}`)}`,
		);
		return;
	}

	if (toolName === "grep") {
		const r = result as { matches: unknown[]; truncated: boolean };
		const n = r.matches.length;
		writeln(
			`${indent}${G.info} ${c.dim(n === 0 ? "no matches" : `${n} match${n === 1 ? "" : "es"}${r.truncated ? " (capped)" : ""}`)}`,
		);
		return;
	}

	if (toolName === "read") {
		const r = result as { totalLines: number; truncated: boolean };
		writeln(
			`${indent}${G.info} ${c.dim(`${r.totalLines} lines${r.truncated ? " (truncated)" : ""}`)}`,
		);
		return;
	}

	if (toolName === "create") {
		const r = result as { path: string; created: boolean };
		const verb = r.created ? c.green("created") : c.dim("overwritten");
		writeln(`${indent}${G.ok} ${verb} ${r.path}`);
		return;
	}

	if (toolName === "replace" || toolName === "insert") {
		const r = result as { path: string; deleted?: boolean };
		const verb =
			toolName === "insert" ? "inserted" : r.deleted ? "deleted" : "replaced";
		writeln(`${indent}${G.ok} ${c.dim(verb)} ${r.path}`);
		return;
	}

	if (toolName === "shell") {
		const r = result as {
			exitCode: number;
			success: boolean;
			timedOut: boolean;
		};
		const badge = r.timedOut
			? c.yellow("timeout")
			: r.success
				? c.green(`✔ ${r.exitCode}`)
				: c.red(`✖ ${r.exitCode}`);
		writeln(`${indent}${badge}`);
		return;
	}

	if (toolName === "subagent") {
		// Activity and token counts are now streamed live.
		return;
	}

	if (toolName.startsWith("mcp_")) {
		const content = Array.isArray(result) ? result : [result];
		const first = (content as Array<{ type?: string; text?: string }>)[0];
		if (first?.type === "text" && first.text) {
			const oneLiner = first.text.split("\n")[0] ?? "";
			if (oneLiner)
				writeln(
					`${indent}${G.info} ${c.dim(oneLiner.length > 80 ? `${oneLiner.slice(0, 77)}…` : oneLiner)}`,
				);
		}
		return;
	}

	// Generic: one-line JSON
	const text = JSON.stringify(result);
	writeln(
		`${indent}${G.info} ${c.dim(text.length > 80 ? `${text.slice(0, 77)}…` : text)}`,
	);
}

export function renderToolResult(
	toolName: string,
	result: unknown,
	isError: boolean,
): void {
	if (isError) {
		const msg =
			typeof result === "string"
				? result
				: result instanceof Error
					? result.message
					: JSON.stringify(result);
		// Trim to one line for error summaries
		const oneLiner = msg.split("\n")[0] ?? msg;
		writeln(`    ${G.err} ${c.red(oneLiner)}`);
		return;
	}

	if (toolName === "glob") {
		const r = result as { files: string[]; truncated: boolean };
		const files = r.files;
		if (files.length === 0) {
			writeln(`    ${G.info} ${c.dim("no matches")}`);
			return;
		}

		// Show up to 12 files, grouped by top-level directory for readability
		const show = files.slice(0, 12);
		const rest = files.length - show.length;

		// Find common prefix to strip for cleaner display
		const prefix = commonPrefix(show);
		for (const f of show) {
			const rel =
				prefix && f.startsWith(prefix)
					? c.dim(prefix) + f.slice(prefix.length)
					: f;
			writeln(`    ${c.dim("·")} ${rel}`);
		}
		if (rest > 0) writeln(`    ${c.dim(`  +${rest} more`)}`);
		if (r.truncated) writeln(`    ${c.dim("  (results capped)")}`);
		return;
	}

	if (toolName === "grep") {
		const r = result as {
			matches: Array<{
				file: string;
				line: number;
				text: string;
				context?: Array<{ line: number; text: string; isMatch: boolean }>;
			}>;
			truncated: boolean;
		};
		if (r.matches.length === 0) {
			writeln(`    ${G.info} ${c.dim("no matches")}`);
			return;
		}

		// Deduplicate by file, show file:line and match text
		const seen = new Set<string>();
		let shown = 0;
		for (const m of r.matches) {
			if (shown >= 10) break;
			const key = m.file;
			const fileLabel = seen.has(key)
				? c.dim(" ".repeat(m.file.length + 1))
				: c.dim(`${m.file}:`);
			seen.add(key);
			writeln(
				`    ${fileLabel}${c.dim(String(m.line))}  ${stripHashlinePrefix(m.text).trim()}`,
			);
			shown++;
		}
		const rest = r.matches.length - shown;
		if (rest > 0) writeln(`    ${c.dim(`  +${rest} more`)}`);
		if (r.truncated) writeln(`    ${c.dim("  (results capped)")}`);
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

		const badge = r.timedOut
			? c.yellow("timeout")
			: r.success
				? c.green(`✔ ${r.exitCode}`)
				: c.red(`✖ ${r.exitCode}`);

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
		// Activity and tokens are streamed live.
		return;
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

export function formatSubagentLabel(
	laneId: number,
	parentLabel?: string,
): string {
	const numStr = parentLabel
		? `${parentLabel.replace(/[\[\]]/g, "")}.${laneId}`
		: `${laneId}`;
	return c.dim(c.cyan(`[${numStr}]`));
}

const laneBuffers = new Map<number, string>();

export function renderSubagentEvent(
	event: TurnEvent,
	opts: {
		laneId: number;
		parentLabel?: string | undefined;
		activeLanes: Set<number>;
	},
): void {
	const { laneId, parentLabel, activeLanes } = opts;

	const labelStr = formatSubagentLabel(laneId, parentLabel);
	const prefix = activeLanes.size > 1 ? `${labelStr} ` : "";

	if (event.type === "text-delta") {
		const buf = (laneBuffers.get(laneId) ?? "") + event.delta;
		const lines = buf.split("\n");
		if (lines.length > 1) {
			for (let i = 0; i < lines.length - 1; i++) {
				writeln(`${prefix}${lines[i]}`);
			}
			laneBuffers.set(laneId, lines[lines.length - 1] ?? "");
		} else {
			laneBuffers.set(laneId, buf);
		}
	} else if (event.type === "tool-call-start") {
		writeln(`${prefix}${toolCallLine(event.toolName, event.args)}`);
	} else if (event.type === "tool-result") {
		// Use inlineResultSummary logic directly here
		renderToolResultInline(
			event.toolName,
			event.result,
			event.isError,
			`${prefix}  `,
		);
	} else if (event.type === "turn-complete") {
		// Flush buffer if any
		const buf = laneBuffers.get(laneId);
		if (buf) {
			writeln(`${prefix}${buf}`);
			laneBuffers.delete(laneId);
		}
		if (event.inputTokens > 0 || event.outputTokens > 0) {
			writeln(
				`${prefix}${c.dim(`↑${event.inputTokens} ↓${event.outputTokens}`)}`,
			);
		}
	} else if (event.type === "turn-error") {
		laneBuffers.delete(laneId);
		logError(event.error, "turn");
		const parsed = parseAppError(event.error);
		writeln(`${prefix}${G.err} ${c.red(parsed.headline)}`);
		if (parsed.hint) {
			writeln(`${prefix}  ${c.dim(parsed.hint)}`);
		}
	}
}
