import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { listSkillsTool, readSkillTool } from "./skills.ts";

describe("skills tools", () => {
	let cwd: string;

	beforeEach(() => {
		cwd = mkdtempSync("/tmp/mc-skills-tool-test-");
		const skillDir = join(cwd, ".agents", "skills", "deploy");
		mkdirSync(skillDir, { recursive: true });
		writeFileSync(
			join(skillDir, "SKILL.md"),
			"---\nname: deploy\ndescription: Deploy app\n---\n\nFull body",
		);
	});

	afterEach(() => {
		rmSync(cwd, { recursive: true, force: true });
	});

	test("listSkills returns metadata only", async () => {
		const result = await listSkillsTool.execute({ cwd });
		expect(result.skills).toEqual([
			{ name: "deploy", description: "Deploy app", source: "local" },
		]);
		expect(
			(result.skills[0] as Record<string, unknown>).content,
		).toBeUndefined();
	});

	test("readSkill returns full content for one skill", async () => {
		const result = await readSkillTool.execute({ cwd, name: "deploy" });
		expect(result.skill?.name).toBe("deploy");
		expect(result.skill?.content).toContain("Full body");
	});

	test("readSkill returns null for unknown skill", async () => {
		const result = await readSkillTool.execute({ cwd, name: "missing" });
		expect(result.skill).toBeNull();
	});
});
