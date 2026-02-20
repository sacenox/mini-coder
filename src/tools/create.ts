import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { z } from "zod";
import type { ToolDef } from "../llm-api/types.ts";
import { generateDiff } from "./diff.ts";

const CreateSchema = z.object({
	path: z.string().describe("File path to write (absolute or relative to cwd)"),
	content: z.string().describe("Full content to write to the file"),
});

type CreateInput = z.infer<typeof CreateSchema> & { cwd?: string };

export interface CreateOutput {
	path: string;
	diff: string;
	created: boolean;
}

export const createTool: ToolDef<CreateInput, CreateOutput> = {
	name: "create",
	description:
		"Create a new file or fully overwrite an existing file with the given content. " +
		"Use this only for new files. " +
		"For targeted line edits on existing files, **use `replace` or `insert` instead**.",
	schema: CreateSchema,
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
