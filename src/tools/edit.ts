import { join, relative } from "node:path";
import { z } from "zod";
import type { ToolDef } from "../llm-api/types.ts";
import { generateDiff } from "./diff.ts";
import { findLineByHash } from "./hashline.ts";

const EditSchema = z.object({
	path: z.string().describe("File path to edit (absolute or relative to cwd)"),
	startAnchor: z
		.string()
		.describe('Start anchor from a prior read/grep, e.g. "11:a3"'),
	endAnchor: z
		.string()
		.optional()
		.describe(
			'End anchor (inclusive), e.g. "33:0e". Omit to target only the startAnchor line.',
		),
	newContent: z
		.string()
		.optional()
		.describe(
			"Replacement text. Omit or pass empty string to delete the range.",
		),
});

type EditInput = z.infer<typeof EditSchema> & { cwd?: string };

export interface EditOutput {
	path: string;
	diff: string;
}

const HASH_NOT_FOUND_ERROR =
	"Hash not found. Re-read the file to get current anchors.";

export const editTool: ToolDef<EditInput, EditOutput> = {
	name: "edit",
	description:
		"Replace or delete a range of lines in an existing file using hashline anchors. " +
		'Anchors come from the `read` or `grep` tools (format: "line:hash", e.g. "11:a3"). ' +
		"Provide startAnchor alone to target a single line, or add endAnchor for a range. " +
		"Set newContent to the replacement text, or omit it to delete the range. " +
		"To create or overwrite a file use `write`. To insert without replacing any lines use `insert`.",
	schema: EditSchema,
	execute: async (input) => {
		const cwd = input.cwd ?? process.cwd();
		const filePath = input.path.startsWith("/")
			? input.path
			: join(cwd, input.path);

		const relPath = relative(cwd, filePath);

		const file = Bun.file(filePath);
		if (!(await file.exists())) {
			throw new Error(
				`File not found: "${relPath}". To create a new file use the \`write\` tool.`,
			);
		}

		const start = parseAnchor(input.startAnchor, "startAnchor");
		const end = input.endAnchor
			? parseAnchor(input.endAnchor, "endAnchor")
			: null;

		if (end && end.line < start.line) {
			throw new Error(
				"endAnchor line number must be >= startAnchor line number.",
			);
		}

		const original = await file.text();
		const lines = original.split("\n");

		const startLine = findLineByHash(lines, start.hash, start.line);
		if (!startLine) throw new Error(HASH_NOT_FOUND_ERROR);

		let endLine = startLine;
		if (end) {
			const resolvedEnd = findLineByHash(lines, end.hash, end.line);
			if (!resolvedEnd) throw new Error(HASH_NOT_FOUND_ERROR);
			endLine = resolvedEnd;
		}
		if (endLine < startLine) {
			throw new Error("endAnchor resolves before startAnchor.");
		}

		const replacement =
			input.newContent === undefined || input.newContent === ""
				? []
				: input.newContent.split("\n");

		const updatedLines = [
			...lines.slice(0, startLine - 1),
			...replacement,
			...lines.slice(endLine),
		];

		const updated = updatedLines.join("\n");
		await Bun.write(filePath, updated);

		const diff = generateDiff(relPath, original, updated);
		return { path: relPath, diff };
	},
};

interface ParsedAnchor {
	line: number;
	hash: string;
}

function parseAnchor(value: string, name: string): ParsedAnchor {
	const match = /^\s*(\d+):([0-9a-fA-F]{2})\s*$/.exec(value);
	if (!match) {
		throw new Error(
			`Invalid ${name}. Expected format: "line:hh" (e.g. "11:a3").`,
		);
	}

	const line = Number(match[1]);
	if (!Number.isInteger(line) || line < 1) {
		throw new Error(`Invalid ${name} line number.`);
	}

	const hash = match[2];
	if (!hash) {
		throw new Error(
			`Invalid ${name}. Expected format: "line:hh" (e.g. "11:a3").`,
		);
	}

	return { line, hash: hash.toLowerCase() };
}
