import { resolve } from "node:path";
import { z } from "zod";
import type { ToolDef } from "../llm-api/types.ts";
import { loadGitignore } from "./ignore.ts";
import { getScannedPathInfo } from "./scan-path.ts";

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
		const defaultIgnore = [".git/**", "node_modules/**"];
		const ignorePatterns = [...defaultIgnore, ...(input.ignore ?? [])];

		const ignoreGlobs = ignorePatterns.map((pat) => new Bun.Glob(pat));

		const ig = await loadGitignore(cwd);

		const glob = new Bun.Glob(input.pattern);
		const matches: Array<{ path: string; mtime: number }> = [];

		for await (const file of glob.scan({ cwd, onlyFiles: true, dot: true })) {
			const { relativePath, ignoreTargets } = getScannedPathInfo(cwd, file);
			const firstSegment = relativePath.split("/")[0] ?? "";

			// Check if ignored by .gitignore
			if (ignoreTargets.some((path) => ig?.ignores(path))) continue;

			// Check explicit ignore patterns
			const ignored = ignoreTargets.some((candidate) =>
				ignoreGlobs.some((g) => g.match(candidate) || g.match(firstSegment)),
			);
			if (ignored) continue;

			try {
				const fullPath = resolve(cwd, relativePath);
				const stat = (await Bun.file(fullPath).stat?.()) ?? null;
				matches.push({
					path: relativePath,
					mtime: stat?.mtime?.getTime() ?? 0,
				});
			} catch {
				matches.push({ path: relativePath, mtime: 0 });
			}

			if (matches.length >= MAX_RESULTS + 1) break;
		}

		const truncated = matches.length > MAX_RESULTS;
		if (truncated) matches.pop();

		// Sort by mtime descending (most recently modified first)
		matches.sort((a, b) => b.mtime - a.mtime);

		const files = matches.map((m) => m.path);

		return { files, count: files.length, truncated };
	},
};
