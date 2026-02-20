import { join, relative } from "node:path";
import { z } from "zod";
import type { ToolDef } from "../llm-api/types.ts";
import { formatHashLine } from "./hashline.ts";

const ReadInput = z.object({
	path: z.string().describe("File path to read (absolute or relative to cwd)"),
	line: z
		.number()
		.int()
		.min(1)
		.optional()
		.describe("1-indexed starting line (default: 1)"),
	count: z
		.number()
		.int()
		.min(1)
		.max(500)
		.optional()
		.describe("Lines to read (default: 500, max: 500)"),
	cwd: z
		.string()
		.optional()
		.describe("Working directory for resolving relative paths"),
});

type ReadInput = z.infer<typeof ReadInput>;

export interface ReadOutput {
	path: string;
	content: string;
	totalLines: number;
	line: number;
	truncated: boolean;
}

const MAX_COUNT = 500;
const MAX_BYTES = 1_000_000;

export const readTool: ToolDef<ReadInput, ReadOutput> = {
	name: "read",
	description:
		"Read a file's contents. `line` sets the starting line (1-indexed, default 1). " +
		"`count` sets how many lines to read (default 500, max 500). " +
		"Check `truncated` and `totalLines` in the result to detect when more content exists; " +
		"paginate by incrementing `line`.",
	schema: ReadInput,
	execute: async (input) => {
		const cwd = input.cwd ?? process.cwd();
		const filePath = input.path.startsWith("/")
			? input.path
			: join(cwd, input.path);

		const file = Bun.file(filePath);
		const exists = await file.exists();
		if (!exists) {
			throw new Error(`File not found: ${input.path}`);
		}

		const size = file.size;
		if (size > MAX_BYTES * 5) {
			throw new Error(
				`File too large (${Math.round(size / 1024)}KB). Use grep to search within it.`,
			);
		}

		const raw = await file.text();
		const allLines = raw.split("\n");
		const totalLines = allLines.length;

		const startLine = input.line ?? 1;
		const count = Math.min(input.count ?? MAX_COUNT, MAX_COUNT);

		const clampedStart = Math.max(1, Math.min(startLine, totalLines));
		const endLine = Math.min(totalLines, clampedStart + count - 1);
		const truncated = endLine < totalLines;

		const selectedLines = allLines.slice(clampedStart - 1, endLine);
		const content = selectedLines
			.map((line, i) => formatHashLine(clampedStart + i, line))
			.join("\n");

		return {
			path: relative(cwd, filePath),
			content,
			totalLines,
			line: clampedStart,
			truncated,
		};
	},
};
