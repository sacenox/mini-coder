import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { z } from "zod";
import type { ToolDef } from "../llm-api/types.ts";
import { generateDiff } from "./diff.ts";

const WriteInput = z.object({
	path: z.string().describe("File path to write (absolute or relative to cwd)"),
	content: z.string().describe("Full content to write to the file"),
	cwd: z
		.string()
		.optional()
		.describe("Working directory for resolving relative paths"),
});

type WriteInput = z.infer<typeof WriteInput>;

export interface WriteOutput {
	path: string;
	diff: string;
	created: boolean;
}

export const writeTool: ToolDef<WriteInput, WriteOutput> = {
	name: "write",
	description:
		"Create a new file or fully overwrite an existing file with the given content. " +
		"Use this for new files or when replacing an entire file. " +
		"For targeted line edits on existing files, use `edit` or `insert` instead.",
	schema: WriteInput,
	execute: async (input) => {
		const cwd = input.cwd ?? process.cwd();
		const filePath = input.path.startsWith("/")
			? input.path
			: join(cwd, input.path);

		const relPath = relative(cwd, filePath);

		const dir = dirname(filePath);
		if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

		const file = Bun.file(filePath);
		const created = !(await file.exists());
		const before = created ? "" : await file.text();

		await Bun.write(filePath, input.content);

		const diff = generateDiff(relPath, before, input.content);
		return { path: relPath, diff, created };
	},
};
