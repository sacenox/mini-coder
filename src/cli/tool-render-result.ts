import * as c from "yoctocolors";
import { G, writeln } from "./output.ts";

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

function writeShellPreviewLines(
	label: string,
	value: string,
	lineColor: (input: string) => string,
	maxLines: number,
): void {
	if (!value.trim()) return;
	const lines = value.split("\n");
	writeln(`    ${c.dim(label)} ${c.dim(`(${lines.length} lines)`)}`);
	for (const line of lines.slice(0, maxLines)) {
		writeln(`    ${lineColor("│")} ${line}`);
	}
	if (lines.length > maxLines) {
		writeln(
			`    ${lineColor("│")} ${c.dim(`… +${lines.length - maxLines} lines`)}`,
		);
	}
}

function renderShellResult(result: {
	stdout: string;
	stderr: string;
	exitCode: number;
	success: boolean;
	timedOut: boolean;
}): void {
	const badge = result.timedOut
		? c.yellow("timeout")
		: result.success
			? c.green("success")
			: c.red("error");

	const stdoutLines = result.stdout.trim()
		? result.stdout.split("\n").length
		: 0;
	const stderrLines = result.stderr.trim()
		? result.stderr.split("\n").length
		: 0;

	writeln(
		`    ${badge} ${c.dim(`exit ${result.exitCode} · stdout ${stdoutLines}L · stderr ${stderrLines}L`)}`,
	);
	writeShellPreviewLines("stdout", result.stdout, c.dim, 6);
	writeShellPreviewLines("stderr", result.stderr, c.red, 4);
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
		renderShellResult(
			result as {
				stdout: string;
				stderr: string;
				exitCode: number;
				success: boolean;
				timedOut: boolean;
			},
		);
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
			writeln(`    ${G.info} ${c.dim("skill")}  ${c.dim("(not found)")}`);
			return;
		}
		const name = r.skill.name ?? "(unknown)";
		const source = r.skill.source ?? "unknown";
		const description = r.skill.description?.trim();
		const descPart = description
			? `  ${c.dim("·")}  ${c.dim(description.length > 60 ? `${description.slice(0, 57)}…` : description)}`
			: "";
		writeln(
			`    ${G.info} ${c.dim("skill")}  ${name}  ${c.dim("·")}  ${c.dim(source)}${descPart}`,
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

	if (toolName.startsWith("mcp_")) {
		const content = Array.isArray(result) ? result : [result];
		for (const block of (
			content as Array<{ type?: string; text?: string }>
		).slice(0, 5)) {
			if (block?.type === "text" && block.text) {
				const lines = block.text.split("\n").slice(0, 6);
				for (const line of lines) writeln(`    ${c.dim("│")} ${line}`);
			}
		}
		return;
	}

	const text = JSON.stringify(result);
	writeln(`    ${c.dim(text.length > 120 ? `${text.slice(0, 117)}…` : text)}`);
}
