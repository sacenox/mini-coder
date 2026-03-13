import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { resolveFileRefs } from "./file-refs.ts";

describe("resolveFileRefs skill expansion", () => {
	let cwd: string;

	beforeEach(() => {
		cwd = mkdtempSync("/tmp/mc-file-refs-test-");
		const skillDir = join(cwd, ".agents", "skills", "deploy");
		mkdirSync(skillDir, { recursive: true });
		writeFileSync(
			join(skillDir, "SKILL.md"),
			"---\nname: deploy\ndescription: Deploy steps\n---\n\nStep 1\nStep 2",
		);
	});

	afterEach(() => {
		rmSync(cwd, { recursive: true, force: true });
	});

	test("expands @skill references with raw SKILL.md content", async () => {
		const out = await resolveFileRefs("run @deploy now", cwd);
		expect(out.images).toEqual([]);
		expect(out.text).toContain('<skill name="deploy">');
		expect(out.text).toContain("name: deploy");
		expect(out.text).toContain("Step 2");
	});

	test("leaves unknown @refs untouched", async () => {
		const out = await resolveFileRefs("run @missing now", cwd);
		expect(out.text).toBe("run @missing now");
	});
});
