import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildSystemPrompt, loadLocalContextFile } from "./system-prompt.ts";

// loadGlobalContextFile reads from ~/.agents which we cannot control in tests.
// We verify local context loading directly and integration via buildSystemPrompt
// with a controlled cwd.

let tmpDir: string;

beforeEach(() => {
	tmpDir = mkdtempSync(join(tmpdir(), "mc-test-"));
});

afterEach(() => {
	rmSync(tmpDir, { recursive: true, force: true });
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
		const prompt = buildSystemPrompt(tmpDir);
		expect(prompt).toContain("You are mini-coder");
		expect(prompt).toContain("Guidelines:");
		expect(prompt).not.toContain("# Project context");
	});

	it("includes delegation guideline in main mode", () => {
		const prompt = buildSystemPrompt(tmpDir);
		expect(prompt).toContain(
			"Use the `subagent` tool sparingly — only for clearly separable",
		);
		expect(prompt).not.toContain("You are running as a subagent");
	});

	it("includes local context under # Project context", () => {
		writeFileSync(join(tmpDir, "AGENTS.md"), "local project info");
		const prompt = buildSystemPrompt(tmpDir);
		expect(prompt).toContain("# Project context");
		expect(prompt).toContain("local project info");
	});

	it("has exactly one # Project context section when local context present", () => {
		writeFileSync(join(tmpDir, "AGENTS.md"), "local info");
		const prompt = buildSystemPrompt(tmpDir);
		const occurrences = prompt.split("# Project context").length - 1;
		expect(occurrences).toBe(1);
	});

	it("appends subagent delegation wording in subagent mode", () => {
		const prompt = buildSystemPrompt(tmpDir, undefined, undefined, true);
		expect(prompt).toContain("You are running as a subagent");
		expect(prompt).toContain(
			"Do not delegate to further subagents unless the subtask is clearly separable",
		);
	});

	it("does not append subagent wording in non-subagent mode", () => {
		const prompt = buildSystemPrompt(tmpDir, undefined, undefined, false);
		expect(prompt).not.toContain("You are running as a subagent");
	});

	it("appends extraSystemPrompt after context and subagent wording", () => {
		writeFileSync(join(tmpDir, "AGENTS.md"), "ctx");
		const prompt = buildSystemPrompt(tmpDir, undefined, "custom extra", true);
		const subagentIdx = prompt.indexOf("You are running as a subagent");
		const extraIdx = prompt.indexOf("custom extra");
		const contextIdx = prompt.indexOf("ctx");
		expect(contextIdx).toBeLessThan(subagentIdx);
		expect(subagentIdx).toBeLessThan(extraIdx);
	});

	it("includes cwd and current time in prompt", () => {
		const prompt = buildSystemPrompt(tmpDir);
		expect(prompt).toContain("Current working directory:");
		expect(prompt).toContain("Current date/time:");
	});
});
