import * as c from "yoctocolors";
import { G, writeln } from "./output.ts";
import { renderDiff, writePreviewLines } from "./tool-result-shared.ts";

function renderReadResult(result: unknown): boolean {
	const r = result as {
		path: string;
		line: number;
		totalLines: number;
		truncated: boolean;
		content?: string;
	};
	if (!r || typeof r.path !== "string") return false;

	const linesReturned = r.content ? r.content.split("\n").length : 0;
	const endLine = linesReturned > 0 ? r.line + linesReturned - 1 : r.line;
	const range =
		r.line === 1 && endLine === r.totalLines
			? `${r.totalLines} lines`
			: `lines ${r.line}–${endLine} of ${r.totalLines}`;
	writeln(
		`    ${G.info} ${c.dim(`${r.path}  ${range}${r.truncated ? "  (truncated)" : ""}`)}`,
	);
	return true;
}

function renderCreateResult(result: unknown): boolean {
	const r = result as { path: string; diff: string; created: boolean };
	if (!r || typeof r.path !== "string") return false;
	const verb = r.created ? c.green("created") : c.dim("overwritten");
	writeln(`    ${G.ok} ${verb} ${r.path}`);
	renderDiff(r.diff);
	return true;
}

function renderReplaceOrInsertResult(
	toolName: string,
	result: unknown,
): boolean {
	const r = result as { path: string; diff: string; deleted?: boolean };
	if (!r || typeof r.path !== "string") return false;
	const verb =
		toolName === "insert" ? "inserted" : r.deleted ? "deleted" : "replaced";
	writeln(`    ${G.ok} ${c.dim(verb)} ${r.path}`);
	renderDiff(r.diff);
	return true;
}

function renderShellResult(result: unknown): boolean {
	const r = result as {
		stdout: string;
		stderr: string;
		exitCode: number;
		success: boolean;
		timedOut: boolean;
	};
	if (!r || typeof r.stdout !== "string" || typeof r.stderr !== "string") {
		return false;
	}

	const badge = r.timedOut
		? c.yellow("timeout")
		: r.success
			? c.green("success")
			: c.red("error");

	const stdoutLines = r.stdout.trim() ? r.stdout.split("\n").length : 0;
	const stderrLines = r.stderr.trim() ? r.stderr.split("\n").length : 0;

	writeln(
		`    ${badge} ${c.dim(`exit ${r.exitCode} · stdout ${stdoutLines}L · stderr ${stderrLines}L`)}`,
	);
	writePreviewLines({
		label: "stdout",
		value: r.stdout,
		lineColor: c.dim,
		maxLines: 6,
	});
	writePreviewLines({
		label: "stderr",
		value: r.stderr,
		lineColor: c.red,
		maxLines: 4,
	});
	return true;
}

function renderSubagentResult(result: unknown): boolean {
	const r = result as {
		inputTokens?: number;
		outputTokens?: number;
		agentName?: string;
	};
	if (!r || typeof r !== "object") return false;
	const label = r.agentName ? ` ${c.dim(c.cyan(`[@${r.agentName}]`))}` : "";
	writeln(
		`    ${G.agent}${label} ${c.dim(`subagent done (${r.inputTokens ?? 0}in / ${r.outputTokens ?? 0}out tokens)`)}`,
	);
	return true;
}

function renderReadSkillResult(result: unknown): boolean {
	const r = result as {
		skill?: {
			name?: string;
			description?: string;
			source?: "local" | "global";
		};
	};
	if (!r || typeof r !== "object") return false;
	if (!r.skill) {
		writeln(`    ${G.info} ${c.dim("skill")}  ${c.dim("(not found)")}`);
		return true;
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
	return true;
}

function renderWebSearchResult(result: unknown): boolean {
	const r = result as {
		results?: Array<{ title?: string; url?: string; score?: number }>;
	};
	if (!Array.isArray(r?.results)) return false;
	if (r.results.length === 0) {
		writeln(`    ${G.info} ${c.dim("no results")}`);
		return true;
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
	return true;
}

function renderWebContentResult(result: unknown): boolean {
	const r = result as {
		results?: Array<{ url?: string; title?: string; text?: string }>;
	};
	if (!Array.isArray(r?.results)) return false;
	if (r.results.length === 0) {
		writeln(`    ${G.info} ${c.dim("no pages")}`);
		return true;
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
	return true;
}

function renderMcpResult(result: unknown): boolean {
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

export function renderToolResultByName(
	toolName: string,
	result: unknown,
): boolean {
	if (toolName === "read") return renderReadResult(result);
	if (toolName === "create") return renderCreateResult(result);
	if (toolName === "replace" || toolName === "insert") {
		return renderReplaceOrInsertResult(toolName, result);
	}
	if (toolName === "shell") return renderShellResult(result);
	if (toolName === "subagent") return renderSubagentResult(result);
	if (toolName === "readSkill") return renderReadSkillResult(result);
	if (toolName === "webSearch") return renderWebSearchResult(result);
	if (toolName === "webContent") return renderWebContentResult(result);
	if (toolName.startsWith("mcp_")) return renderMcpResult(result);
	return false;
}
