import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { z } from "zod";
import type { ToolDef } from "../llm-api/types.ts";

const EditInput = z.object({
	path: z.string().describe("File path to edit (absolute or relative to cwd)"),
	oldString: z
		.string()
		.describe(
			"Exact string to find and replace. Must match exactly including whitespace and indentation. " +
				"Must be unique in the file. To create a new file, pass an empty string.",
		),
	newString: z
		.string()
		.describe(
			"String to replace oldString with. Pass empty string to delete oldString.",
		),
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

export const editTool: ToolDef<EditInput, EditOutput> = {
	name: "edit",
	description:
		"Edit a file by replacing an exact string with a new string. " +
		"The oldString must match exactly (including whitespace). " +
		"To create a new file, pass oldString as empty string. " +
		"To delete text, pass newString as empty string. " +
		"Prefer small, focused edits over replacing large blocks.",
	schema: EditInput,
	execute: async (input) => {
		const cwd = input.cwd ?? process.cwd();
		const filePath = input.path.startsWith("/")
			? input.path
			: join(cwd, input.path);

		const relPath = relative(cwd, filePath);
		let created = false;

		// ── Creating a new file ──────────────────────────────────────────────────
		if (input.oldString === "") {
			const dir = dirname(filePath);
			if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

			const existing = await Bun.file(filePath).exists();
			if (existing) {
				throw new Error(
					`File "${relPath}" already exists. Provide oldString to edit an existing file.`,
				);
			}

			await Bun.write(filePath, input.newString);
			created = true;

			const diff = generateDiff(relPath, "", input.newString);
			return { path: relPath, success: true, diff, created };
		}

		// ── Editing an existing file ─────────────────────────────────────────────
		const file = Bun.file(filePath);
		const exists = await file.exists();
		if (!exists) {
			throw new Error(
				`File not found: "${relPath}". To create a new file, pass oldString as empty string.`,
			);
		}

		const original = await file.text();

		// Check uniqueness
		const firstIdx = original.indexOf(input.oldString);
		if (firstIdx === -1) {
			throw new Error(
				`oldString not found in "${relPath}". Make sure it matches exactly including whitespace and indentation.`,
			);
		}
		const secondIdx = original.indexOf(input.oldString, firstIdx + 1);
		if (secondIdx !== -1) {
			throw new Error(
				`oldString matches multiple locations in "${relPath}". Provide more surrounding context to make it unique.`,
			);
		}

		const updated = original.replace(input.oldString, input.newString);
		await Bun.write(filePath, updated);

		const diff = generateDiff(relPath, original, updated);
		return { path: relPath, success: true, diff, created };
	},
};

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
