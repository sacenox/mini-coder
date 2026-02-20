import { join, relative } from "node:path";
import { z } from "zod";
import type { ToolDef } from "../llm-api/types.ts";

const GlobSchema = z.object({
	pattern: z
		.string()
		.describe("Glob pattern to match files against, e.g. '**/*.ts'"),
	ignore: z.array(z.string()).optional().describe("Glob patterns to exclude"),
});

type GlobInput = z.infer<typeof GlobSchema> & { cwd?: string };

export interface GlobOutput {
	files: string[];
	count: number;
	truncated: boolean;
}

const MAX_RESULTS = 500;

export const globTool: ToolDef<GlobInput, GlobOutput> = {
	name: "glob",
	description:
		"Find files matching a glob pattern. Returns relative paths sorted by modification time. " +
		"Use this to discover files before reading them.",
	schema: GlobSchema,
	execute: async (input) => {
		const cwd = input.cwd ?? process.cwd();
		const defaultIgnore = [
			"node_modules/**",
			".git/**",
			"dist/**",
			"*.db",
			"*.db-shm",
			"*.db-wal",
		];
		const ignorePatterns = [...defaultIgnore, ...(input.ignore ?? [])];

		const glob = new Bun.Glob(input.pattern);
		const matches: Array<{ path: string; mtime: number }> = [];

		for await (const file of glob.scan({ cwd, onlyFiles: true })) {
			// Check ignore patterns
			const ignored = ignorePatterns.some((pat) => {
				const ig = new Bun.Glob(pat);
				return ig.match(file);
			});
			if (ignored) continue;

			try {
				const fullPath = join(cwd, file);
				const stat = (await Bun.file(fullPath).stat?.()) ?? null;
				matches.push({ path: file, mtime: stat?.mtime?.getTime() ?? 0 });
			} catch {
				matches.push({ path: file, mtime: 0 });
			}

			if (matches.length >= MAX_RESULTS + 1) break;
		}

		const truncated = matches.length > MAX_RESULTS;
		if (truncated) matches.pop();

		// Sort by mtime descending (most recently modified first)
		matches.sort((a, b) => b.mtime - a.mtime);

		const files = matches.map((m) => relative(cwd, join(cwd, m.path)));

		return { files, count: files.length, truncated };
	},
};
