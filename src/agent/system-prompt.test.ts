import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildSystemPrompt, loadLocalContextFile } from "./system-prompt.ts";

let tmpDir: string;
let fakeHome: string;

beforeEach(() => {
	tmpDir = mkdtempSync(join(tmpdir(), "mc-test-"));
	fakeHome = mkdtempSync(join(tmpdir(), "mc-home-"));
});

afterEach(() => {
	rmSync(tmpDir, { recursive: true, force: true });
	rmSync(fakeHome, { recursive: true, force: true });
});

describe("loadLocalContextFile", () => {
	it("returns null when no context files exist", () => {
		expect(loadLocalContextFile(tmpDir)).toBeNull();
	});

	it("reads .agents/AGENTS.md (highest priority)", () => {
		mkdirSync(join(tmpDir, ".agents"), { recursive: true });
		writeFileSync(join(tmpDir, ".agents", "AGENTS.md"), "agents content");
		writeFileSync(join(tmpDir, "AGENTS.md"), "root content");
		writeFileSync(join(tmpDir, "CLAUDE.md"), "claude content");
		expect(loadLocalContextFile(tmpDir)).toBe("agents content");
	});

	it("reads CLAUDE.md when .agents/AGENTS.md absent", () => {
		writeFileSync(join(tmpDir, "CLAUDE.md"), "claude content");
		writeFileSync(join(tmpDir, "AGENTS.md"), "root content");
		expect(loadLocalContextFile(tmpDir)).toBe("claude content");
	});

	it("reads AGENTS.md at root when others absent", () => {
		writeFileSync(join(tmpDir, "AGENTS.md"), "root content");
		expect(loadLocalContextFile(tmpDir)).toBe("root content");
	});
});

describe("buildSystemPrompt", () => {
	it("includes base guidelines without context files", () => {
		const prompt = buildSystemPrompt(
			"mock-time-anchor",
			tmpDir,
			undefined,
			undefined,
			fakeHome,
		);
		expect(prompt).toContain("You are mini-coder");
		expect(prompt).toContain("Guidelines:");
		expect(prompt).not.toContain("# Project context");
		expect(prompt).toContain("# Safety and risk boundaries");
		expect(prompt).toContain("# Workspace guardrails");
		expect(prompt).toContain("# Progress communication");
		expect(prompt).toContain("# Final response style");
		expect(prompt).toContain("Do not guess unknown facts");
	});

	it("includes local context under # Project context", () => {
		writeFileSync(join(tmpDir, "AGENTS.md"), "local project info");
		const prompt = buildSystemPrompt(
			"mock-time-anchor",
			tmpDir,
			undefined,
			undefined,
			fakeHome,
		);
		expect(prompt).toContain("# Project context");
		expect(prompt).toContain("local project info");
	});

	it("has exactly one # Project context section when local context present", () => {
		writeFileSync(join(tmpDir, "AGENTS.md"), "local info");
		const prompt = buildSystemPrompt(
			"mock-time-anchor",
			tmpDir,
			undefined,
			undefined,
			fakeHome,
		);
		const occurrences = prompt.split("# Project context").length - 1;
		expect(occurrences).toBe(1);
	});

	it("appends subagent delegation wording in subagent mode", () => {
		const prompt = buildSystemPrompt(
			"mock-time-anchor",
			tmpDir,
			undefined,
			true,
			fakeHome,
		);
		expect(prompt).toContain("You are running as a subagent");
		expect(prompt).toContain(
			"Do not spawn further subagents unless the subtask is unambiguously separable",
		);
	});

	it("does not append subagent wording in non-subagent mode", () => {
		const prompt = buildSystemPrompt(
			"mock",
			tmpDir,
			undefined,
			false,
			fakeHome,
		);
		expect(prompt).not.toContain("You are running as a subagent");
	});

	it("appends extraSystemPrompt after context and subagent wording", () => {
		writeFileSync(join(tmpDir, "AGENTS.md"), "ctx");
		const prompt = buildSystemPrompt(
			"mock",
			tmpDir,
			"custom extra",
			true,
			fakeHome,
		);
		const subagentIdx = prompt.indexOf("You are running as a subagent");
		const extraIdx = prompt.indexOf("custom extra");
		const contextIdx = prompt.indexOf("ctx");
		expect(contextIdx).toBeLessThan(subagentIdx);
		expect(subagentIdx).toBeLessThan(extraIdx);
	});

	it("includes cwd and current time in prompt", () => {
		const prompt = buildSystemPrompt(
			"mock",
			tmpDir,
			undefined,
			undefined,
			fakeHome,
		);
		expect(prompt).toContain("Current working directory:");
		expect(prompt).toContain("Current date/time:");
	});

	it("includes global context when ~/.agents/AGENTS.md present", () => {
		mkdirSync(join(fakeHome, ".agents"), { recursive: true });
		writeFileSync(join(fakeHome, ".agents", "AGENTS.md"), "global info");
		const prompt = buildSystemPrompt(
			"mock",
			tmpDir,
			undefined,
			undefined,
			fakeHome,
		);
		expect(prompt).toContain("# Project context");
		expect(prompt).toContain("global info");
	});

	it("includes both global and local context in order (global before local)", () => {
		mkdirSync(join(fakeHome, ".agents"), { recursive: true });
		writeFileSync(join(fakeHome, ".agents", "AGENTS.md"), "global info");
		writeFileSync(join(tmpDir, "AGENTS.md"), "local info");
		const prompt = buildSystemPrompt(
			"mock",
			tmpDir,
			undefined,
			undefined,
			fakeHome,
		);
		expect(prompt).toContain("global info");
		expect(prompt).toContain("local info");
		expect(prompt.indexOf("global info")).toBeLessThan(
			prompt.indexOf("local info"),
		);
	});

	it("does not include # Project context when neither global nor local context present", () => {
		const prompt = buildSystemPrompt(
			"mock",
			tmpDir,
			undefined,
			undefined,
			fakeHome,
		);
		expect(prompt).not.toContain("# Project context");
	});

	it("includes skill metadata guidance when skills are discoverable", () => {
		const skillDir = join(tmpDir, ".agents", "skills", "deploy");
		mkdirSync(skillDir, { recursive: true });
		writeFileSync(
			join(skillDir, "SKILL.md"),
			"---\nname: deploy\ndescription: Deploy safely\n---\n\n# Deploy\nDetailed body",
		);

		const prompt = buildSystemPrompt(
			"mock",
			tmpDir,
			undefined,
			undefined,
			fakeHome,
		);
		expect(prompt).toContain("# Available skills (metadata only)");
		expect(prompt).toContain(
			"Use `listSkills` to browse and `readSkill` to load one SKILL.md on demand.",
		);
		expect(prompt).toContain("- deploy: Deploy safely (local)");
		expect(prompt).not.toContain("Detailed body");
	});

	it("includes globally discovered skill metadata when homeDir is provided", () => {
		const skillDir = join(fakeHome, ".agents", "skills", "release");
		mkdirSync(skillDir, { recursive: true });
		writeFileSync(
			join(skillDir, "SKILL.md"),
			"---\nname: release\ndescription: Ship releases\n---\n\nRelease body",
		);

		const prompt = buildSystemPrompt(
			"mock",
			tmpDir,
			undefined,
			undefined,
			fakeHome,
		);
		expect(prompt).toContain("- release: Ship releases (global)");
		expect(prompt).not.toContain("Release body");
	});
});
