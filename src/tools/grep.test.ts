import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { grepTool } from "./grep.ts";

describe("grepTool", () => {
	let root: string;

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "mc-grep-test-"));
		mkdirSync(join(root, "src"));
		writeFileSync(join(root, ".gitignore"), "");
		writeFileSync(join(root, "src", "notes.md"), "OpenAI auth token\n");
		writeFileSync(
			join(root, "src", "ignore.txt"),
			"openai should be skipped by extension\n",
		);
	});

	afterEach(() => {
		rmSync(root, { recursive: true, force: true });
	});

	test("normalizes absolute include patterns and returns relative file paths", async () => {
		const result = await grepTool.execute({
			cwd: root,
			pattern: "OpenAI",
			include: join(root, "**", "*.md"),
			caseSensitive: false,
			contextLines: 2,
			maxResults: 50,
		});

		expect(result.matches).toHaveLength(1);
		expect(result.matches[0]?.file).toBe("src/notes.md");
		expect(result.matches[0]?.file.startsWith("/")).toBe(false);
		expect(result.matches[0]?.file.startsWith("..")).toBe(false);
	});

	test("ignores default-ignore directories outside cwd", async () => {
		const outside = mkdtempSync(join(dirname(root), "mc-grep-outside-"));
		mkdirSync(join(outside, ".git"));
		writeFileSync(join(outside, "allowed.txt"), "OpenAI inside allowed\n");
		writeFileSync(
			join(outside, ".git", "secrets.txt"),
			"OpenAI hidden token\n",
		);

		try {
			const result = await grepTool.execute({
				cwd: root,
				pattern: "OpenAI",
				include: join(outside, "**", "*.txt"),
				caseSensitive: false,
				contextLines: 2,
				maxResults: 50,
			});

			expect(result.matches).toHaveLength(1);
			expect(
				result.matches.some((match) => match.file.endsWith("allowed.txt")),
			).toBe(true);
			expect(
				result.matches.some((match) => match.file.includes(".git/secrets.txt")),
			).toBe(false);
		} finally {
			rmSync(outside, { recursive: true, force: true });
		}
	});
});
