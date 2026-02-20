import { join } from "node:path";
import { z } from "zod";
import type { ToolDef } from "../llm-api/types.ts";
import { formatHashLine } from "./hashline.ts";

const GrepInput = z.object({
	pattern: z.string().describe("Regular expression to search for"),
	include: z
		.string()
		.optional()
		.describe("Glob pattern to filter files, e.g. '*.ts' or '*.{ts,tsx}'"),
	cwd: z
		.string()
		.optional()
		.describe("Directory to search in (defaults to process.cwd())"),
	contextLines: z
		.number()
		.int()
		.min(0)
		.max(10)
		.optional()
		.default(2)
		.describe("Lines of context to include around each match"),
	caseSensitive: z.boolean().optional().default(true),
	maxResults: z.number().int().min(1).max(200).optional().default(50),
});

type GrepInput = z.infer<typeof GrepInput>;

export interface GrepMatch {
	file: string;
	line: number;
	column: number;
	text: string;
	context: Array<{ line: number; text: string; isMatch: boolean }>;
}

export interface GrepOutput {
	matches: GrepMatch[];
	totalMatches: number;
	truncated: boolean;
}

const DEFAULT_IGNORE = [
	"node_modules",
	".git",
	"dist",
	"*.db",
	"*.db-shm",
	"*.db-wal",
	"bun.lock",
];

export const grepTool: ToolDef<GrepInput, GrepOutput> = {
	name: "grep",
	description:
		"Search for a regex pattern across files. Returns file paths, line numbers, and context. " +
		"Use this to find code patterns, function definitions, or specific text.",
	schema: GrepInput,
	execute: async (input) => {
		const cwd = input.cwd ?? process.cwd();
		const flags = input.caseSensitive ? "" : "i";
		const regex = new RegExp(input.pattern, flags);
		const maxResults = input.maxResults ?? 50;
		const contextLines = input.contextLines ?? 2;
		const include = input.include ?? "**/*";

		const fileGlob = new Bun.Glob(include);
		const ignoreGlob = DEFAULT_IGNORE.map((p) => new Bun.Glob(p));

		const allMatches: GrepMatch[] = [];
		let truncated = false;

		outer: for await (const relPath of fileGlob.scan({
			cwd,
			onlyFiles: true,
		})) {
			// Skip ignored
			if (
				ignoreGlob.some(
					(g) => g.match(relPath) || g.match(relPath.split("/")[0] ?? ""),
				)
			) {
				continue;
			}

			const fullPath = join(cwd, relPath);
			let text: string;
			try {
				text = await Bun.file(fullPath).text();
			} catch {
				continue;
			}

			// Skip binary-ish files
			if (text.includes("\0")) continue;

			const lines = text.split("\n");

			for (let i = 0; i < lines.length; i++) {
				const line = lines[i] ?? "";
				const match = regex.exec(line);
				if (!match) continue;

				// Gather context
				const ctxStart = Math.max(0, i - contextLines);
				const ctxEnd = Math.min(lines.length - 1, i + contextLines);
				const context: GrepMatch["context"] = [];
				for (let c = ctxStart; c <= ctxEnd; c++) {
					context.push({
						line: c + 1,
						text: formatHashLine(c + 1, lines[c] ?? ""),
						isMatch: c === i,
					});
				}

				allMatches.push({
					file: relPath,
					line: i + 1,
					column: match.index + 1,
					text: formatHashLine(i + 1, line),
					context,
				});

				if (allMatches.length >= maxResults + 1) {
					truncated = true;
					break outer;
				}
			}
		}

		if (truncated) allMatches.pop();

		return {
			matches: allMatches,
			totalMatches: allMatches.length,
			truncated,
		};
	},
};
