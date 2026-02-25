import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSkills } from "./skills.ts";

describe("loadSkills", () => {
	let dir: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "mc-skills-test-"));
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	function writeSkill(root: string, folderName: string, content: string): void {
		const skillDir = join(root, ".agents", "skills", folderName);
		mkdirSync(skillDir, { recursive: true });
		writeFileSync(join(skillDir, "SKILL.md"), content);
	}

	test("returns empty map when no .agents/skills dir exists", () => {
		expect(loadSkills(dir).size).toBe(0);
	});

	test("loads a skill with name and description from frontmatter", () => {
		writeSkill(
			dir,
			"git-release",
			"---\nname: git-release\ndescription: Create consistent releases\n---\n\n# Instructions\nUse conventional commits.",
		);
		const skills = loadSkills(dir);
		const skill = skills.get("git-release");
		expect(skill?.name).toBe("git-release");
		expect(skill?.description).toBe("Create consistent releases");
		expect(skill?.content).toContain("Use conventional commits.");
		expect(skill?.source).toBe("local");
	});

	test("falls back to folder name when frontmatter has no name", () => {
		writeSkill(dir, "my-skill", "---\ndescription: A skill\n---\nContent.");
		const skills = loadSkills(dir);
		// key is name from frontmatter or folder name
		expect(skills.get("my-skill")?.name).toBe("my-skill");
	});

	test("falls back to name as description when frontmatter has none", () => {
		writeSkill(dir, "no-desc", "---\nname: no-desc\n---\nContent.");
		expect(loadSkills(dir).get("no-desc")?.description).toBe("no-desc");
	});

	test("skill content includes the raw SKILL.md text", () => {
		const raw =
			"---\nname: test-skill\ndescription: Test\n---\n\nDo the thing.";
		writeSkill(dir, "test-skill", raw);
		expect(loadSkills(dir).get("test-skill")?.content).toBe(raw);
	});

	test("ignores entries without a SKILL.md", () => {
		const skillDir = join(dir, ".agents", "skills", "empty-folder");
		mkdirSync(skillDir, { recursive: true });
		expect(loadSkills(dir).size).toBe(0);
	});

	test("ignores non-directory entries in skills dir", () => {
		const skillsDir = join(dir, ".agents", "skills");
		mkdirSync(skillsDir, { recursive: true });
		writeFileSync(join(skillsDir, "not-a-dir.md"), "stuff");
		expect(loadSkills(dir).size).toBe(0);
	});

	test("local skill overrides global with same name", () => {
		writeSkill(
			dir,
			"git-release",
			"---\nname: git-release\ndescription: local version\n---\nLocal content.",
		);
		const skills = loadSkills(dir);
		expect(skills.get("git-release")?.description).toBe("local version");
		expect(skills.get("git-release")?.source).toBe("local");
	});
});
