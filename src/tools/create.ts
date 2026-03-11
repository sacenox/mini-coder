import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import type { ToolDef } from "../llm-api/types.ts";
import { generateDiff } from "./diff.ts";
import { resolvePath } from "./shared.ts";
import type { WriteResultMeta } from "./write-result.ts";

const CreateSchema = z.object({
	path: z.string().describe("File path to write (absolute or relative to cwd)"),
	content: z.string().describe("Full content to write to the file"),
});

type CreateInput = z.infer<typeof CreateSchema> & { cwd?: string };

interface CreateOutput {
	path: string;
	diff: string;
	created: boolean;
}

export interface CreateToolOutput extends CreateOutput, WriteResultMeta {}

export const createTool: ToolDef<CreateInput, CreateToolOutput> = {
	name: "create",
	description:
		"Write a file at the given path, creating it or fully replacing its content. " +
		"**For targeted line edits on existing files use `replace` or `insert` — never `create`.**",
	schema: CreateSchema,
	execute: async (input) => {
		const { filePath, relPath } = resolvePath(input.cwd, input.path);

		const dir = dirname(filePath);
		if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

		const file = Bun.file(filePath);
		const created = !(await file.exists());
		const before = created ? "" : await file.text();

		await Bun.write(filePath, input.content);

		const diff = generateDiff(relPath, before, input.content);
		return {
			path: relPath,
			diff,
			created,
			_filePath: filePath,
			_before: before,
		};
	},
};
