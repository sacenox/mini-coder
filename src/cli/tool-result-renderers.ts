import * as c from "yoctocolors";
import { G, writeln } from "./output.ts";

interface ToolResultRenderOptions {
	verboseOutput?: boolean;
}

type ToolResultRenderer = (
	result: unknown,
	opts?: ToolResultRenderOptions,
	toolName?: string,
) => boolean;
function writePreviewLines(opts: {
	label: string;
	value: string;
	lineColor: (input: string) => string;
	maxLines: number;
}): void {
	if (!opts.value.trim()) return;
	const lines = opts.value.split("\n");
	writeln(`    ${c.dim(opts.label)} ${c.dim(`(${lines.length} lines)`)}`);
	if (!Number.isFinite(opts.maxLines) || lines.length <= opts.maxLines) {
		for (const line of lines) {
			writeln(`    ${opts.lineColor("│")} ${line}`);
		}
		return;
	}

	const headCount = Math.max(1, Math.ceil(opts.maxLines / 2));
	const tailCount = Math.max(0, Math.floor(opts.maxLines / 2));
	for (const line of lines.slice(0, headCount)) {
		writeln(`    ${opts.lineColor("│")} ${line}`);
	}
	const hiddenLines = Math.max(0, lines.length - (headCount + tailCount));
	if (hiddenLines > 0) {
		writeln(`    ${opts.lineColor("│")} ${c.dim(`… +${hiddenLines} lines`)}`);
	}
	if (tailCount > 0) {
		for (const line of lines.slice(-tailCount)) {
			writeln(`    ${opts.lineColor("│")} ${line}`);
		}
	}
}

function truncateOneLine(
	value: string,
	max = 100,
	verboseOutput = false,
): string {
	if (verboseOutput) return value;
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
	verboseOutput: boolean;
}): string[] {
	const parts = [`exit ${opts.exitCode}`];

	if (
		opts.stderrLines === 0 &&
		opts.stdoutSingleLine !== null &&
		opts.stdoutSingleLine.length > 0
	) {
		parts.push(
			`out: ${truncateOneLine(opts.stdoutSingleLine, 100, opts.verboseOutput)}`,
		);
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

function renderShellResult(
	result: unknown,
	opts?: ToolResultRenderOptions,
): boolean {
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

	const verboseOutput = opts?.verboseOutput === true;
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
		verboseOutput,
	});

	writeln(`    ${badge} ${c.dim(parts.join(" · "))}`);

	writePreviewLines({
		label: "stderr",
		value: r.stderr,
		lineColor: c.red,
		maxLines: verboseOutput ? Number.POSITIVE_INFINITY : 10,
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
			maxLines: verboseOutput ? Number.POSITIVE_INFINITY : 20,
		});
	}

	return true;
}
function renderSubagentResult(
	result: unknown,
	_opts?: ToolResultRenderOptions,
): boolean {
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

function buildSkillDescriptionPart(
	description: string | undefined,
	verboseOutput = false,
): string {
	const trimmed = description?.trim();
	if (!trimmed) return "";
	if (verboseOutput) return `  ${c.dim("·")}  ${c.dim(trimmed)}`;
	return `  ${c.dim("·")}  ${c.dim(trimmed.length > 60 ? `${trimmed.slice(0, 57)}…` : trimmed)}`;
}

function renderSkillSummaryLine(
	skill: {
		name?: string;
		description?: string;
		source?: "local" | "global";
	},
	opts?: { label?: string; verboseOutput?: boolean },
): void {
	const name = skill.name ?? "(unknown)";
	const source = skill.source ?? "unknown";
	const labelPrefix = opts?.label ? `${c.dim(opts.label)}  ` : "";
	writeln(
		`    ${G.info} ${labelPrefix}${name}  ${c.dim("·")}  ${c.dim(source)}${buildSkillDescriptionPart(skill.description, opts?.verboseOutput === true)}`,
	);
}

function renderListSkillsResult(
	result: unknown,
	opts?: ToolResultRenderOptions,
): boolean {
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

	const maxSkills = opts?.verboseOutput ? r.skills.length : 6;
	for (const skill of r.skills.slice(0, maxSkills)) {
		renderSkillSummaryLine(skill, {
			verboseOutput: opts?.verboseOutput === true,
		});
	}

	if (r.skills.length > maxSkills) {
		writeln(`    ${c.dim(`+${r.skills.length - maxSkills} more skills`)}`);
	}
	return true;
}

function renderReadSkillResult(
	result: unknown,
	_opts?: ToolResultRenderOptions,
): boolean {
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
	renderSkillSummaryLine(r.skill, {
		label: "skill",
		verboseOutput: _opts?.verboseOutput === true,
	});
	return true;
}

function renderWebSearchResult(
	result: unknown,
	opts?: ToolResultRenderOptions,
): boolean {
	const r = result as {
		results?: Array<{ title?: string; url?: string; score?: number }>;
	};
	if (!Array.isArray(r?.results)) return false;
	if (r.results.length === 0) {
		writeln(`    ${G.info} ${c.dim("no results")}`);
		return true;
	}

	const maxResults = opts?.verboseOutput ? r.results.length : 5;
	for (const item of r.results.slice(0, maxResults)) {
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

	if (r.results.length > maxResults) {
		writeln(`    ${c.dim(`  +${r.results.length - maxResults} more`)}`);
	}
	return true;
}

function renderWebContentResult(
	result: unknown,
	opts?: ToolResultRenderOptions,
): boolean {
	const r = result as {
		results?: Array<{ url?: string; title?: string; text?: string }>;
	};
	if (!Array.isArray(r?.results)) return false;
	if (r.results.length === 0) {
		writeln(`    ${G.info} ${c.dim("no pages")}`);
		return true;
	}

	const maxPages = opts?.verboseOutput ? r.results.length : 3;
	for (const item of r.results.slice(0, maxPages)) {
		const title = (item.title?.trim() || item.url || "(untitled)").replace(
			/\s+/g,
			" ",
		);
		writeln(`    ${c.dim("•")} ${title}`);
		if (item.url) writeln(`      ${c.dim(item.url)}`);
		const preview = (item.text ?? "").replace(/\s+/g, " ").trim();
		if (preview) {
			const trimmed =
				opts?.verboseOutput || preview.length <= 220
					? preview
					: `${preview.slice(0, 217)}…`;
			writeln(`      ${c.dim(trimmed)}`);
		}
	}

	if (r.results.length > maxPages) {
		writeln(`    ${c.dim(`  +${r.results.length - maxPages} more`)}`);
	}
	return true;
}

function renderMcpResult(
	result: unknown,
	opts?: ToolResultRenderOptions,
): boolean {
	const content = Array.isArray(result) ? result : [result];
	const maxBlocks = opts?.verboseOutput ? content.length : 5;
	let rendered = false;
	for (const block of (
		content as Array<{ type?: string; text?: string }>
	).slice(0, maxBlocks)) {
		if (block?.type === "text" && block.text) {
			const maxLines = opts?.verboseOutput ? Number.POSITIVE_INFINITY : 6;
			const lines = block.text.split("\n").slice(0, maxLines);
			for (const line of lines) writeln(`    ${c.dim("│")} ${line}`);
			rendered = true;
		}
	}
	return rendered;
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
	opts?: ToolResultRenderOptions,
): boolean {
	if (toolName.startsWith("mcp_")) {
		return renderMcpResult(result, opts);
	}

	const renderer = TOOL_RESULT_RENDERERS[toolName];
	if (!renderer) return false;
	return renderer(result, opts, toolName);
}
