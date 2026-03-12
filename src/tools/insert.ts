import { z } from "zod";
import type { ToolDef } from "../llm-api/types.ts";
import { findLineByHash } from "./hashline.ts";
import { applyFileEdit, parseAnchor, resolveExistingFile } from "./shared.ts";
import type { WriteResultMeta } from "./write-result.ts";

const InsertSchema = z.object({
	path: z.string().describe("File path to edit (absolute or relative to cwd)"),
	anchor: z
		.string()
		.describe('Anchor line from a prior read/grep, e.g. "11:a3"'),
	position: z
		.enum(["before", "after"])
		.describe('Insert the content "before" or "after" the anchor line'),
	content: z.string().describe("Text to insert"),
});

type InsertInput = z.infer<typeof InsertSchema> & {
	cwd?: string;
	snapshotCallback?: (filePath: string) => Promise<void>;
};

interface InsertOutput {
	path: string;
	diff: string;
}

export interface InsertToolOutput extends InsertOutput, WriteResultMeta {}

const HASH_NOT_FOUND_ERROR =
	"Hash not found. Re-read the file to get current anchors.";

export const insertTool: ToolDef<InsertInput, InsertToolOutput> = {
	name: "insert",
	description:
		"Insert new lines before or after an anchor line in an existing file. " +
		"The anchor line itself is not modified. " +
		'Anchors come from the `read` or `grep` tools (format: "line:hash", e.g. "11:a3"). ' +
		"To replace or delete lines use `replace`. To create a file use `create`.",
	schema: InsertSchema,
	execute: async (input) => {
		const { file, filePath, relPath } = await resolveExistingFile(
			input.cwd,
			input.path,
		);

		const parsed = parseAnchor(input.anchor);

		const original = await file.text();
		const lines = original.split("\n");

		const anchorLine = findLineByHash(lines, parsed.hash, parsed.line);
		if (!anchorLine) throw new Error(HASH_NOT_FOUND_ERROR);

		const insertAt = input.position === "before" ? anchorLine - 1 : anchorLine;
		const insertLines = input.content.split("\n");

		const updatedLines = [
			...lines.slice(0, insertAt),
			...insertLines,
			...lines.slice(insertAt),
		];

		const updated = updatedLines.join("\n");
		return applyFileEdit(
			input.snapshotCallback,
			filePath,
			relPath,
			original,
			updated,
		);
	},
};
