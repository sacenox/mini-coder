import * as c from "yoctocolors";
import { G, writeln } from "./output.ts";

type ToolResultRenderer = (result: unknown, toolName?: string) => boolean;
function writePreviewLines(opts: {
	label: string;
	value: string;
	lineColor: (input: string) => string;
	maxLines: number;
}): void {
	if (!opts.value.trim()) return;
	const lines = opts.value.split("\n");
	writeln(`    ${c.dim(opts.label)} ${c.dim(`(${lines.length} lines)`)}`);
	for (const line of lines.slice(0, opts.maxLines)) {
		writeln(`    ${opts.lineColor("│")} ${line}`);
	}
	if (lines.length > opts.maxLines) {
		writeln(
			`    ${opts.lineColor("│")} ${c.dim(`… +${lines.length - opts.maxLines} lines`)}`,
		);
	}
}

function truncateOneLine(value: string, max = 100): string {
	return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function normalizeShellText(value: string): string {
	return value.replace(/[\r\n]+$/, "");
}

function countShellLines(value: string): number {
	const normalized = normalizeShellText(value);
	return normalized ? normalized.split(/\r?\n/).length : 0;
}

function getSingleShellLine(value: string): string | null {
	const normalized = normalizeShellText(value);
	if (!normalized) return null;
	const lines = normalized.split(/\r?\n/);
	return lines.length === 1 ? (lines[0] ?? "") : null;
}

function buildShellSummaryParts(opts: {
	exitCode: number;
	stdoutLines: number;
	stderrLines: number;
	stdoutSingleLine: string | null;
	streamedOutput: boolean;
}): string[] {
	const parts = [`exit ${opts.exitCode}`];
	if (opts.streamedOutput) {
		if (opts.stdoutLines === 0 && opts.stderrLines === 0) {
			parts.push("no output");
		}
		if (opts.stderrLines > 0) {
			parts.push(`stderr ${opts.stderrLines}L`);
		}
		return parts;
	}

	if (
		opts.stderrLines === 0 &&
		opts.stdoutSingleLine !== null &&
		opts.stdoutSingleLine.length > 0
	) {
		parts.push(`out: ${truncateOneLine(opts.stdoutSingleLine)}`);
		return parts;
	}

	if (opts.stdoutLines > 0) {
		parts.push(`stdout ${opts.stdoutLines}L`);
	}
	if (opts.stderrLines > 0) {
		parts.push(`stderr ${opts.stderrLines}L`);
	}
	if (opts.stdoutLines === 0 && opts.stderrLines === 0) {
		parts.push("no output");
	}
	return parts;
}

function shouldPreviewShellStdout(opts: {
	success: boolean;
	stdoutLines: number;
	stderrLines: number;
	stdoutSingleLine: string | null;
}): boolean {
	if (opts.stdoutLines === 0) return false;
	if (!opts.success || opts.stderrLines > 0) return true;
	return opts.stdoutSingleLine === null;
}

function renderShellResult(result: unknown): boolean {
	const r = result as {
		stdout: string;
		stderr: string;
		exitCode: number;
		success: boolean;
		timedOut: boolean;
		streamedOutput?: boolean;
	};
	if (!r || typeof r.stdout !== "string" || typeof r.stderr !== "string") {
		return false;
	}

	const streamedOutput = r.streamedOutput === true;
	const stdoutLines = countShellLines(r.stdout);
	const stderrLines = countShellLines(r.stderr);
	const stdoutSingleLine = getSingleShellLine(r.stdout);
	const badge = r.timedOut
		? c.yellow("timeout")
		: r.success
			? c.green("done")
			: c.red("error");
	const parts = buildShellSummaryParts({
		exitCode: r.exitCode,
		stdoutLines,
		stderrLines,
		stdoutSingleLine,
		streamedOutput,
	});

	writeln(`    ${badge} ${c.dim(parts.join(" · "))}`);

	if (streamedOutput) {
		return true;
	}

	writePreviewLines({
		label: "stderr",
		value: r.stderr,
		lineColor: c.red,
		maxLines: 6,
	});
	if (
		shouldPreviewShellStdout({
			success: r.success && !r.timedOut,
			stdoutLines,
			stderrLines,
			stdoutSingleLine,
		})
	) {
		writePreviewLines({
			label: "stdout",
			value: r.stdout,
			lineColor: c.dim,
			maxLines: 4,
		});
	}

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

function buildSkillDescriptionPart(description: string | undefined): string {
	const trimmed = description?.trim();
	if (!trimmed) return "";
	return `  ${c.dim("·")}  ${c.dim(trimmed.length > 60 ? `${trimmed.slice(0, 57)}…` : trimmed)}`;
}

function renderSkillSummaryLine(
	skill: {
		name?: string;
		description?: string;
		source?: "local" | "global";
	},
	label?: string,
): void {
	const name = skill.name ?? "(unknown)";
	const source = skill.source ?? "unknown";
	const labelPrefix = label ? `${c.dim(label)}  ` : "";
	writeln(
		`    ${G.info} ${labelPrefix}${name}  ${c.dim("·")}  ${c.dim(source)}${buildSkillDescriptionPart(skill.description)}`,
	);
}

function renderListSkillsResult(result: unknown): boolean {
	const r = result as {
		skills?: Array<{
			name?: string;
			description?: string;
			source?: "local" | "global";
		}>;
	};
	if (!Array.isArray(r?.skills)) return false;
	if (r.skills.length === 0) {
		writeln(`    ${G.info} ${c.dim("no skills")}`);
		return true;
	}

	for (const skill of r.skills.slice(0, 6)) {
		renderSkillSummaryLine(skill);
	}

	if (r.skills.length > 6) {
		writeln(`    ${c.dim(`+${r.skills.length - 6} more skills`)}`);
	}
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
	renderSkillSummaryLine(r.skill, "skill");
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

const TOOL_RESULT_RENDERERS: Readonly<Record<string, ToolResultRenderer>> = {
	shell: renderShellResult,
	subagent: renderSubagentResult,
	listSkills: renderListSkillsResult,
	readSkill: renderReadSkillResult,
	webSearch: renderWebSearchResult,
	webContent: renderWebContentResult,
};

export function renderToolResultByName(
	toolName: string,
	result: unknown,
): boolean {
	if (toolName.startsWith("mcp_")) {
		return renderMcpResult(result);
	}

	const renderer = TOOL_RESULT_RENDERERS[toolName];
	if (!renderer) return false;
	return renderer(result, toolName);
}
