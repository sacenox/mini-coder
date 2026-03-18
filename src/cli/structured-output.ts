import { createTwoFilesPatch } from "diff";
import type {
	ApplyExactTextEditResult,
	FileEditErrorCode,
} from "../internal/file-edit/exact-text.ts";

function shouldColorize(): boolean {
	return process.env.FORCE_COLOR === "1" || process.env.FORCE_COLOR === "true";
}

/** Raw ANSI codes for diff coloring (works in piped subprocesses). */
const ansi = {
	red: (s: string) => `\x1b[31m${s}\x1b[39m`,
	green: (s: string) => `\x1b[32m${s}\x1b[39m`,
	cyan: (s: string) => `\x1b[36m${s}\x1b[39m`,
	dim: (s: string) => `\x1b[2m${s}\x1b[22m`,
};

export interface StructuredOutputWriter {
	stdout: (text: string) => void;
	stderr: (text: string) => void;
}

type FileEditCliSuccess = { ok: true } & ApplyExactTextEditResult;

export interface FileEditCliFailure {
	ok: false;
	code: FileEditErrorCode | "invalid_args";
	message: string;
	path?: string;
}

export function writeJsonLine(
	write: (text: string) => void,
	payload: unknown,
): void {
	write(`${JSON.stringify(payload)}\n`);
}

function normalizePatchLines(patchText: string): string[] {
	const patchLines = patchText.split("\n");
	while (patchLines.at(-1) === "") {
		patchLines.pop();
	}

	const diffLines = patchLines.filter(
		(line) =>
			!line.startsWith("Index: ") &&
			line !==
				"===================================================================",
	);

	return diffLines.map((line) => {
		if (line.startsWith("--- ") || line.startsWith("+++ ")) {
			return line.split("\t", 1)[0] ?? line;
		}
		return line;
	});
}

function colorizeDiffLine(line: string): string {
	if (line.startsWith("---") || line.startsWith("+++")) return ansi.dim(line);
	if (line.startsWith("@@")) return ansi.cyan(line);
	if (line.startsWith("+")) return ansi.green(line);
	if (line.startsWith("-")) return ansi.red(line);
	return line;
}

export function renderUnifiedDiff(
	filePath: string,
	before: string,
	after: string,
): string {
	if (before === after) {
		return "(no changes)";
	}

	const patchText = createTwoFilesPatch(
		filePath,
		filePath,
		before,
		after,
		"",
		"",
		{
			context: 3,
		},
	);
	const lines = normalizePatchLines(patchText);
	if (shouldColorize()) {
		return lines.map(colorizeDiffLine).join("\n");
	}
	return lines.join("\n");
}

function renderMetadataBlock(
	result: FileEditCliSuccess | FileEditCliFailure,
): string {
	const lines = [`ok: ${result.ok}`];
	if ("path" in result && result.path) {
		lines.push(`path: ${result.path}`);
	}
	if (result.ok) {
		lines.push(`changed: ${result.changed}`);
	} else {
		lines.push(`code: ${result.code}`);
		lines.push(`message: ${result.message}`);
	}
	return lines.join("\n");
}

export function writeFileEditResult(
	io: StructuredOutputWriter,
	result: FileEditCliSuccess | FileEditCliFailure,
): void {
	if (result.ok) {
		const sections = [
			renderUnifiedDiff(result.path, result.before, result.after),
			renderMetadataBlock(result),
		];
		io.stdout(`${sections.join("\n\n")}\n`);
		return;
	}

	io.stderr(`${renderMetadataBlock(result)}\n`);
}
