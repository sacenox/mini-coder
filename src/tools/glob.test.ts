import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { globTool } from "./glob.ts";

describe("globTool", () => {
	let root: string;

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "mc-glob-test-"));
		mkdirSync(join(root, "src"));
		writeFileSync(join(root, ".gitignore"), "");
		writeFileSync(join(root, "src", "a.ts"), "export const ok = true;\n");
		writeFileSync(join(root, "src", "a.md"), "note\n");
	});

	afterEach(() => {
		rmSync(root, { recursive: true, force: true });
	});

	test("normalizes absolute patterns to cwd-relative results", async () => {
		const result = await globTool.execute({
			cwd: root,
			pattern: join(root, "**", "*.ts"),
		});

		expect(result.files).toContain("src/a.ts");
		expect(
			result.files.every((p) => !p.startsWith("/") && !p.startsWith("..")),
		).toBe(true);
	});

	test("ignores default-ignore directories outside cwd", async () => {
		const outside = mkdtempSync(join(dirname(root), "mc-glob-outside-"));
		mkdirSync(join(outside, ".git"));
		writeFileSync(join(outside, "ok.txt"), "ok\n");
		writeFileSync(join(outside, ".git", "ignored.txt"), "ignore\n");

		try {
			const result = await globTool.execute({
				cwd: root,
				pattern: join(outside, "**", "*"),
			});

			expect(
				result.files.some((file) => file.endsWith("ok.txt")),
				"Expected outside allowed file to be discovered",
			).toBe(true);
			expect(
				result.files.some((file) => file.endsWith(".git/ignored.txt")),
			).toBe(false);
		} finally {
			rmSync(outside, { recursive: true, force: true });
		}
	});
});
