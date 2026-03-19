import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { resolveFileRefs } from "./file-refs.ts";

describe("resolveFileRefs", () => {
	let cwd: string;

	beforeEach(() => {
		cwd = mkdtempSync("/tmp/mc-file-refs-test-");
	});

	afterEach(() => {
		rmSync(cwd, { recursive: true, force: true });
	});

	test("expands @file references with file content", async () => {
		writeFileSync(join(cwd, "hello.txt"), "hello world");
		const out = await resolveFileRefs("see @hello.txt please", cwd);
		expect(out.images).toEqual([]);
		expect(out.text).toContain("hello world");
		expect(out.text).not.toContain("@hello.txt");
	});

	test("leaves unknown @refs untouched", async () => {
		const out = await resolveFileRefs("run @missing now", cwd);
		expect(out.text).toBe("run @missing now");
	});

	test("does not resolve @ref as skill", async () => {
		const skillDir = join(cwd, ".agents", "skills", "deploy");
		mkdirSync(skillDir, { recursive: true });
		writeFileSync(
			join(skillDir, "SKILL.md"),
			"---\nname: deploy\ndescription: Deploy steps\n---\n\nStep 1\nStep 2",
		);
		const out = await resolveFileRefs("run @deploy now", cwd);
		expect(out.text).toBe("run @deploy now");
	});
});
