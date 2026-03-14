import { z } from "zod";
import type { ToolDef } from "../llm-api/types.ts";
import { findLineByHash } from "./hashline.ts";
import { applyFileEdit, parseAnchor, resolveExistingFile } from "./shared.ts";
import type { WriteResultMeta } from "./write-result.ts";

const ReplaceSchema = z.object({
	path: z.string().describe("File path to edit (absolute or relative to cwd)"),
	startAnchor: z
		.string()
		.describe('Start anchor from a prior read, e.g. "11:a3"'),
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

type ReplaceInput = z.infer<typeof ReplaceSchema> & {
	cwd?: string;
	snapshotCallback?: (filePath: string) => Promise<void>;
};

interface ReplaceOutput {
	path: string;
	diff: string;
	deleted: boolean;
}

export interface ReplaceToolOutput extends ReplaceOutput, WriteResultMeta {}

const HASH_NOT_FOUND_ERROR =
	"Hash not found. Re-read the file to get current anchors.";

export const replaceTool: ToolDef<ReplaceInput, ReplaceToolOutput> = {
	name: "replace",
	description:
		"Replace or delete a range of lines in an existing file using hashline anchors. " +
		'Anchors come from the `read` tool (format: "line:hash", e.g. "11:a3"). ' +
		"Provide startAnchor alone to target a single line, or add endAnchor for a range. " +
		"Set newContent to the replacement text, or omit it to delete the range. " +
		"To create a file use `create`. To insert without replacing any lines use `insert`.",
	schema: ReplaceSchema,
	execute: async (input) => {
		const { file, filePath, relPath } = await resolveExistingFile(
			input.cwd,
			input.path,
		);
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
		const editResult = await applyFileEdit(
			input.snapshotCallback,
			filePath,
			relPath,
			original,
			updated,
		);
		return {
			...editResult,
			deleted: replacement.length === 0,
		};
	},
};
