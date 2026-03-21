import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadLocalContextFile } from "./context-files.ts";
import { buildSystemPrompt } from "./system-prompt.ts";

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

  it("reads all context files when multiple exist", () => {
    mkdirSync(join(tmpDir, ".agents"), { recursive: true });
    writeFileSync(join(tmpDir, ".agents", "AGENTS.md"), "agents content");
    writeFileSync(join(tmpDir, "AGENTS.md"), "root content");
    writeFileSync(join(tmpDir, "CLAUDE.md"), "claude content");
    const result = loadLocalContextFile(tmpDir) as string;
    expect(result).toContain("agents content");
    expect(result).toContain("claude content");
    expect(result).toContain("root content");
  });

  it("reads both CLAUDE.md and AGENTS.md when .agents dir absent", () => {
    writeFileSync(join(tmpDir, "CLAUDE.md"), "claude content");
    writeFileSync(join(tmpDir, "AGENTS.md"), "root content");
    const result = loadLocalContextFile(tmpDir) as string;
    expect(result).toContain("claude content");
    expect(result).toContain("root content");
  });

  it("reads AGENTS.md at root when others absent", () => {
    writeFileSync(join(tmpDir, "AGENTS.md"), "root content");
    expect(loadLocalContextFile(tmpDir)).toBe("root content");
  });

  it("reads .claude/CLAUDE.md when .agents files absent", () => {
    mkdirSync(join(tmpDir, ".claude"), { recursive: true });
    writeFileSync(join(tmpDir, ".claude", "CLAUDE.md"), "claude dir content");
    expect(loadLocalContextFile(tmpDir)).toBe("claude dir content");
  });

  it("reads .agents/CLAUDE.md when .agents/AGENTS.md absent", () => {
    mkdirSync(join(tmpDir, ".agents"), { recursive: true });
    writeFileSync(
      join(tmpDir, ".agents", "CLAUDE.md"),
      "agents claude content",
    );
    expect(loadLocalContextFile(tmpDir)).toBe("agents claude content");
  });

  it("walks ancestor directories up to git root", () => {
    mkdirSync(join(tmpDir, ".git"), { recursive: true });
    writeFileSync(join(tmpDir, "AGENTS.md"), "root context");
    const nested = join(tmpDir, "packages", "lib", "src");
    mkdirSync(nested, { recursive: true });
    expect(loadLocalContextFile(nested)).toBe("root context");
  });

  it("stops walking at git root and does not go beyond", () => {
    const gitRoot = join(tmpDir, "repo");
    mkdirSync(join(gitRoot, ".git"), { recursive: true });
    writeFileSync(join(tmpDir, "AGENTS.md"), "outside git");
    const nested = join(gitRoot, "src");
    mkdirSync(nested, { recursive: true });
    expect(loadLocalContextFile(nested)).toBeNull();
  });

  it("nearest context file wins over ancestor", () => {
    mkdirSync(join(tmpDir, ".git"), { recursive: true });
    writeFileSync(join(tmpDir, "AGENTS.md"), "root context");
    const nested = join(tmpDir, "packages", "lib");
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(nested, "AGENTS.md"), "nested context");
    expect(loadLocalContextFile(nested)).toBe("nested context");
  });
});

describe("buildSystemPrompt", () => {
  it("includes base guidelines without context files", () => {
    const prompt = buildSystemPrompt("mock-time-anchor", tmpDir, fakeHome);
    expect(prompt).toContain("You are mini-coder");
    expect(prompt).toContain("Guidelines:");
    expect(prompt).not.toContain("# Project context");
    expect(prompt).toContain("# Safety");
    expect(prompt).toContain("# Communication");
    expect(prompt).toContain("# Error handling");
    expect(prompt).toContain(
      "Inspect code and files primarily through shell commands",
    );
    expect(prompt).toContain("invoke `mc-edit` via shell");
    expect(prompt).toContain("check the available skills list below");
    expect(prompt).toContain("never guess unknown state");
  });

  it("includes local context under # Project context", () => {
    writeFileSync(join(tmpDir, "AGENTS.md"), "local project info");
    const prompt = buildSystemPrompt("mock-time-anchor", tmpDir, fakeHome);
    expect(prompt).toContain("# Project context");
    expect(prompt).toContain("local project info");
  });

  it("has exactly one # Project context section when local context present", () => {
    writeFileSync(join(tmpDir, "AGENTS.md"), "local info");
    const prompt = buildSystemPrompt("mock-time-anchor", tmpDir, fakeHome);
    const occurrences = prompt.split("# Project context").length - 1;
    expect(occurrences).toBe(1);
  });

  it("includes cwd and current time in prompt", () => {
    const prompt = buildSystemPrompt("mock", tmpDir, fakeHome);
    expect(prompt).toContain("Current working directory:");
    expect(prompt).toContain("Current date/time:");
  });

  it("includes global context when ~/.agents/AGENTS.md present", () => {
    mkdirSync(join(fakeHome, ".agents"), { recursive: true });
    writeFileSync(join(fakeHome, ".agents", "AGENTS.md"), "global info");
    const prompt = buildSystemPrompt("mock", tmpDir, fakeHome);
    expect(prompt).toContain("# Project context");
    expect(prompt).toContain("global info");
  });

  it("includes global context from ~/.claude/CLAUDE.md", () => {
    mkdirSync(join(fakeHome, ".claude"), { recursive: true });
    writeFileSync(join(fakeHome, ".claude", "CLAUDE.md"), "claude global info");
    const prompt = buildSystemPrompt("mock", tmpDir, fakeHome);
    expect(prompt).toContain("# Project context");
    expect(prompt).toContain("claude global info");
  });

  it("includes both global and local context in order (global before local)", () => {
    mkdirSync(join(fakeHome, ".agents"), { recursive: true });
    writeFileSync(join(fakeHome, ".agents", "AGENTS.md"), "global info");
    writeFileSync(join(tmpDir, "AGENTS.md"), "local info");
    const prompt = buildSystemPrompt("mock", tmpDir, fakeHome);
    expect(prompt).toContain("global info");
    expect(prompt).toContain("local info");
    expect(prompt.indexOf("global info")).toBeLessThan(
      prompt.indexOf("local info"),
    );
  });

  it("does not include # Project context when neither global nor local context present", () => {
    const prompt = buildSystemPrompt("mock", tmpDir, fakeHome);
    expect(prompt).not.toContain("# Project context");
  });

  it("includes skill metadata guidance when skills are discoverable", () => {
    const skillDir = join(tmpDir, ".agents", "skills", "deploy");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, "SKILL.md"),
      "---\nname: deploy\ndescription: Deploy safely\n---\n\n# Deploy\nDetailed body",
    );

    const prompt = buildSystemPrompt("mock", tmpDir, fakeHome);
    expect(prompt).toContain("# Available skills (metadata only)");
    expect(prompt).toContain(
      "Use `listSkills` to browse and `readSkill` to load one SKILL.md on demand.",
    );
    expect(prompt).toContain("- deploy: Deploy safely (local,");
    expect(prompt).toContain(".agents/skills/deploy/SKILL.md)");
    expect(prompt).not.toContain("Detailed body");
  });

  it("includes globally discovered skill metadata when homeDir is provided", () => {
    const skillDir = join(fakeHome, ".agents", "skills", "release");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, "SKILL.md"),
      "---\nname: release\ndescription: Ship releases\n---\n\nRelease body",
    );

    const prompt = buildSystemPrompt("mock", tmpDir, fakeHome);
    expect(prompt).toContain("- release: Ship releases (global,");
    expect(prompt).not.toContain("Release body");
  });
});
