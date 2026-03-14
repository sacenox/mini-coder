import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import type { ToolDef } from "../llm-api/types.ts";
import { resolvePath } from "./shared.ts";
import type { WriteResultMeta } from "./write-result.ts";

const CreateSchema = z.object({
	path: z.string().describe("File path to write (absolute or relative to cwd)"),
	content: z.string().describe("Full content to write to the file"),
});

type CreateInput = z.infer<typeof CreateSchema> & {
	cwd?: string;
	snapshotCallback?: (filePath: string) => Promise<void>;
};

interface CreateOutput {
	path: string;
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

		await input.snapshotCallback?.(filePath);
		await Bun.write(filePath, input.content);

		// diff deferred to finalizeWriteResult / stripWriteResultMeta.
		return {
			path: relPath,
			created,
			_filePath: filePath,
			_before: before,
			_updated: input.content,
		};
	},
};
