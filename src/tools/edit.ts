import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { z } from "zod";
import type { ToolDef } from "../llm-api/types.ts";
import { findLineByHash } from "./hashline.ts";

const EditInput = z.object({
	path: z.string().describe("File path to edit (absolute or relative to cwd)"),
	startAnchor: z.string().optional().describe('Start anchor, e.g. "11:a3"'),
	endAnchor: z
		.string()
		.optional()
		.describe('End anchor (inclusive), e.g. "33:0e"'),
	newContent: z
		.string()
		.optional()
		.describe("Replacement text. Omit or pass empty string to delete a range."),
	insertPosition: z
		.enum(["before", "after"])
		.optional()
		.describe("Insert-only position relative to startAnchor"),
	cwd: z
		.string()
		.optional()
		.describe("Working directory for resolving relative paths"),
});

type EditInput = z.infer<typeof EditInput>;

export interface EditOutput {
	path: string;
	success: boolean;
	/** Unified-style diff of the change */
	diff: string;
	created: boolean;
}

const HASH_NOT_FOUND_ERROR =
	"Hash not found. Re-read the file to get current anchors.";

export const editTool: ToolDef<EditInput, EditOutput> = {
	name: "edit",
	description:
		"Edit a file using hashline anchors. Provide startAnchor (and optional endAnchor) " +
		"to replace or delete a range. Use insertPosition with startAnchor to insert text. " +
		"To create a new file, omit startAnchor and provide newContent.",
	schema: EditInput,
	execute: async (input) => {
		const cwd = input.cwd ?? process.cwd();
		const filePath = input.path.startsWith("/")
			? input.path
			: join(cwd, input.path);

		const relPath = relative(cwd, filePath);
		let created = false;

		// ── Creating a new file ──────────────────────────────────────────────────
		if (!input.startAnchor) {
			if (input.endAnchor || input.insertPosition) {
				throw new Error(
					"startAnchor is required for edits. Omit it only to create a new file.",
				);
			}
			if (input.newContent === undefined) {
				throw new Error("newContent is required to create a new file.");
			}

			const dir = dirname(filePath);
			if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

			const existing = await Bun.file(filePath).exists();
			if (existing) {
				throw new Error(
					`File "${relPath}" already exists. Provide startAnchor to edit an existing file.`,
				);
			}

			await Bun.write(filePath, input.newContent);
			created = true;

			const diff = generateDiff(relPath, "", input.newContent);
			return { path: relPath, success: true, diff, created };
		}

		// ── Editing an existing file ─────────────────────────────────────────────
		const file = Bun.file(filePath);
		const exists = await file.exists();
		if (!exists) {
			throw new Error(
				`File not found: "${relPath}". To create a new file, omit startAnchor.`,
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
		if (input.insertPosition && input.endAnchor) {
			throw new Error("insertPosition cannot be used with endAnchor.");
		}
		if (input.insertPosition && input.newContent === undefined) {
			throw new Error("newContent is required for insert operations.");
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

		let updatedLines: string[];
		if (input.insertPosition) {
			const insertLines = (input.newContent ?? "").split("\n");
			const insertAt =
				input.insertPosition === "before" ? startLine - 1 : startLine;
			updatedLines = [
				...lines.slice(0, insertAt),
				...insertLines,
				...lines.slice(insertAt),
			];
		} else {
			const replacement =
				input.newContent === undefined || input.newContent === ""
					? []
					: input.newContent.split("\n");
			const startIdx = startLine - 1;
			const endIdx = (end ? endLine : startLine) - 1;
			updatedLines = [
				...lines.slice(0, startIdx),
				...replacement,
				...lines.slice(endIdx + 1),
			];
		}

		const updated = updatedLines.join("\n");
		await Bun.write(filePath, updated);

		const diff = generateDiff(relPath, original, updated);
		return { path: relPath, success: true, diff, created };
	},
};

interface ParsedAnchor {
	line: number;
	hash: string;
}

function parseAnchor(value: string, name: string): ParsedAnchor {
	const match = /^\s*(\d+):([0-9a-fA-F]{2})\s*$/.exec(value);
	if (!match) {
		throw new Error(`Invalid ${name}. Expected "line:hh".`);
	}

	const line = Number(match[1]);
	if (!Number.isInteger(line) || line < 1) {
		throw new Error(`Invalid ${name} line number.`);
	}

	const hash = match[2];
	if (!hash) {
		throw new Error(`Invalid ${name}. Expected "line:hh".`);
	}

	return { line, hash: hash.toLowerCase() };
}

// ─── Simple unified diff generator ───────────────────────────────────────────

function generateDiff(filePath: string, before: string, after: string): string {
	const beforeLines = before === "" ? [] : before.split("\n");
	const afterLines = after === "" ? [] : after.split("\n");

	// Find changed regions using a simple LCS-based approach
	// For our use case, we just show the hunks around the changed area
	const diff = computeUnifiedDiff(beforeLines, afterLines);

	if (diff.length === 0) return "(no changes)";

	return `--- ${filePath}\n+++ ${filePath}\n${diff}`;
}

function computeUnifiedDiff(before: string[], after: string[]): string {
	const CONTEXT = 3;

	// Simple O(n) approach: find the first and last differing line
	let firstDiff = -1;
	let lastDiffBefore = before.length;
	let lastDiffAfter = after.length;

	for (let i = 0; i < Math.max(before.length, after.length); i++) {
		if (before[i] !== after[i]) {
			if (firstDiff === -1) firstDiff = i;
			lastDiffBefore = i + 1;
			lastDiffAfter = i + 1;
		}
	}

	if (firstDiff === -1) return "";

	const hunkStart = Math.max(0, firstDiff - CONTEXT);
	const hunkEndBefore = Math.min(before.length, lastDiffBefore + CONTEXT);
	const hunkEndAfter = Math.min(after.length, lastDiffAfter + CONTEXT);

	const lines: string[] = [];
	lines.push(
		`@@ -${hunkStart + 1},${hunkEndBefore - hunkStart} ` +
			`+${hunkStart + 1},${hunkEndAfter - hunkStart} @@`,
	);

	// Context before
	for (let i = hunkStart; i < firstDiff; i++) {
		lines.push(` ${before[i] ?? ""}`);
	}

	// Removed lines
	for (let i = firstDiff; i < lastDiffBefore && i < before.length; i++) {
		lines.push(`-${before[i] ?? ""}`);
	}

	// Added lines
	for (let i = firstDiff; i < lastDiffAfter && i < after.length; i++) {
		lines.push(`+${after[i] ?? ""}`);
	}

	// Context after
	for (let i = lastDiffBefore; i < hunkEndBefore && i < before.length; i++) {
		lines.push(` ${before[i] ?? ""}`);
	}

	return lines.join("\n");
}
