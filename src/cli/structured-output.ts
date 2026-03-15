import { createTwoFilesPatch } from "diff";
import * as c from "yoctocolors";
import type {
	ApplyExactTextEditResult,
	FileEditErrorCode,
} from "../internal/file-edit/exact-text.ts";

export interface StructuredOutputWriter {
	stdout: (text: string) => void;
	stderr: (text: string) => void;
	supportsColor?: boolean;
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

export function renderUnifiedDiff(
	filePath: string,
	before: string,
	after: string,
	colorize = true,
): string {
	if (before === after) {
		return colorize ? c.dim("(no changes)") : "(no changes)";
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

	return lines
		.map((line) => {
			if (!colorize) return line;
			if (line.startsWith("+++ ") || line.startsWith("+")) {
				return c.green(line);
			}
			if (line.startsWith("--- ") || line.startsWith("-")) {
				return c.red(line);
			}
			if (line.startsWith("@@ ")) {
				return c.cyan(line);
			}
			if (line.startsWith("\\")) {
				return c.dim(line);
			}
			return line;
		})
		.join("\n");
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
			renderUnifiedDiff(
				result.path,
				result.before,
				result.after,
				io.supportsColor ?? process.stdout.isTTY === true,
			),
			renderMetadataBlock(result),
		];
		io.stdout(`${sections.join("\n\n")}\n`);
		return;
	}

	io.stderr(`${renderMetadataBlock(result)}\n`);
}
