import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { GitState } from "./git.ts";
import {
  buildSystemPrompt,
  discoverAgentsMd,
  formatGitLine,
} from "./prompt.ts";
import type { Skill } from "./skills.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "mc-prompt-"));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// discoverAgentsMd
// ---------------------------------------------------------------------------

describe("discoverAgentsMd", () => {
  test("finds AGENTS.md walking from cwd to scan root", () => {
    writeFileSync(join(tmp, "AGENTS.md"), "Root instructions");
    mkdirSync(join(tmp, "src"), { recursive: true });
    writeFileSync(join(tmp, "src", "AGENTS.md"), "Src instructions");

    const cwd = join(tmp, "src");
    const root = resolve(tmp);
    const files = discoverAgentsMd(cwd, root);

    // Should be ordered root-to-leaf
    expect(files).toHaveLength(2);
    expect(files[0]!.path).toBe(join(tmp, "AGENTS.md"));
    expect(files[0]!.content).toBe("Root instructions");
    expect(files[1]!.path).toBe(join(tmp, "src", "AGENTS.md"));
    expect(files[1]!.content).toBe("Src instructions");
  });

  test("returns empty array when no files found", () => {
    const files = discoverAgentsMd(tmp, resolve(tmp));
    expect(files).toEqual([]);
  });

  test("checks globalAgentsDir for global agent instructions", () => {
    const globalDir = join(tmp, "global-agents");
    mkdirSync(globalDir, { recursive: true });
    writeFileSync(join(globalDir, "AGENTS.md"), "Global instructions");

    writeFileSync(join(tmp, "AGENTS.md"), "Project instructions");

    const files = discoverAgentsMd(tmp, resolve(tmp), globalDir);

    // Global instructions come first (general → specific)
    expect(files).toHaveLength(2);
    expect(files[0]!.content).toBe("Global instructions");
    expect(files[1]!.content).toBe("Project instructions");
  });

  test("does not walk above the scan root", () => {
    const parent = join(tmp, "parent");
    const child = join(parent, "child");
    mkdirSync(child, { recursive: true });

    // Put AGENTS.md above scan root — should NOT be found
    writeFileSync(join(tmp, "AGENTS.md"), "Above root");
    // Put AGENTS.md at scan root — should be found
    writeFileSync(join(parent, "AGENTS.md"), "At root");

    const files = discoverAgentsMd(child, resolve(parent));
    expect(files).toHaveLength(1);
    expect(files[0]!.content).toBe("At root");
  });

  test("orders files root-to-leaf (general → specific)", () => {
    const deep = join(tmp, "a", "b", "c");
    mkdirSync(deep, { recursive: true });

    writeFileSync(join(tmp, "AGENTS.md"), "level-0");
    writeFileSync(join(tmp, "a", "AGENTS.md"), "level-1");
    writeFileSync(join(tmp, "a", "b", "AGENTS.md"), "level-2");

    const files = discoverAgentsMd(join(tmp, "a", "b"), resolve(tmp));
    expect(files).toHaveLength(3);
    expect(files[0]!.content).toBe("level-0");
    expect(files[1]!.content).toBe("level-1");
    expect(files[2]!.content).toBe("level-2");
  });
});

// ---------------------------------------------------------------------------
// formatGitLine
// ---------------------------------------------------------------------------

describe("formatGitLine", () => {
  test("formats full git state", () => {
    const state: GitState = {
      root: "/repo",
      branch: "main",
      staged: 3,
      modified: 1,
      untracked: 2,
      ahead: 5,
      behind: 2,
    };

    const line = formatGitLine(state);
    expect(line).toBe(
      "Git: branch main | 3 staged, 1 modified, 2 untracked | +5 −2 vs origin/main",
    );
  });

  test("omits staged/modified/untracked when all zero", () => {
    const state: GitState = {
      root: "/repo",
      branch: "main",
      staged: 0,
      modified: 0,
      untracked: 0,
      ahead: 0,
      behind: 0,
    };

    const line = formatGitLine(state);
    expect(line).toBe("Git: branch main");
  });

  test("omits fields that are zero", () => {
    const state: GitState = {
      root: "/repo",
      branch: "feature",
      staged: 0,
      modified: 2,
      untracked: 0,
      ahead: 0,
      behind: 0,
    };

    const line = formatGitLine(state);
    expect(line).toBe("Git: branch feature | 2 modified");
  });

  test("omits ahead/behind when both zero", () => {
    const state: GitState = {
      root: "/repo",
      branch: "dev",
      staged: 1,
      modified: 0,
      untracked: 0,
      ahead: 0,
      behind: 0,
    };

    const line = formatGitLine(state);
    expect(line).toBe("Git: branch dev | 1 staged");
  });

  test("shows only ahead when behind is zero", () => {
    const state: GitState = {
      root: "/repo",
      branch: "main",
      staged: 0,
      modified: 0,
      untracked: 0,
      ahead: 3,
      behind: 0,
    };

    const line = formatGitLine(state);
    expect(line).toBe("Git: branch main | +3 vs origin/main");
  });

  test("shows only behind when ahead is zero", () => {
    const state: GitState = {
      root: "/repo",
      branch: "main",
      staged: 0,
      modified: 0,
      untracked: 0,
      ahead: 0,
      behind: 4,
    };

    const line = formatGitLine(state);
    expect(line).toBe("Git: branch main | −4 vs origin/main");
  });
});

// ---------------------------------------------------------------------------
// buildSystemPrompt
// ---------------------------------------------------------------------------

describe("buildSystemPrompt", () => {
  test("includes base instructions", () => {
    const prompt = buildSystemPrompt({
      cwd: "/home/user/project",
      date: "2026-04-05",
    });

    expect(prompt).toContain("You are mini-coder");
    expect(prompt).toContain("# Role");
    expect(prompt).toContain("# Tools");
    expect(prompt).toContain("# Code quality");
    expect(prompt).toContain("# Editing discipline");
    expect(prompt).toContain("# Communication");
    expect(prompt).toContain("# Persistence");
  });

  test("includes session footer with date and cwd", () => {
    const prompt = buildSystemPrompt({
      cwd: "/home/user/project",
      date: "2026-04-05",
    });

    expect(prompt).toContain("Current date: 2026-04-05");
    expect(prompt).toContain("Current working directory: /home/user/project");
  });

  test("includes git line when git state provided", () => {
    const prompt = buildSystemPrompt({
      cwd: "/home/user/project",
      date: "2026-04-05",
      git: {
        root: "/home/user/project",
        branch: "main",
        staged: 3,
        modified: 1,
        untracked: 2,
        ahead: 5,
        behind: 2,
      },
    });

    expect(prompt).toContain("Git: branch main");
  });

  test("omits git line when git state is null", () => {
    const prompt = buildSystemPrompt({
      cwd: "/tmp/no-repo",
      date: "2026-04-05",
      git: null,
    });

    expect(prompt).not.toContain("Git:");
  });

  test("includes AGENTS.md content when provided", () => {
    const prompt = buildSystemPrompt({
      cwd: "/project",
      date: "2026-04-05",
      agentsMd: [
        {
          path: "/project/AGENTS.md",
          content: "Always use TypeScript strict mode.",
        },
      ],
    });

    expect(prompt).toContain("# Project Context");
    expect(prompt).toContain("## /project/AGENTS.md");
    expect(prompt).toContain("Always use TypeScript strict mode.");
  });

  test("includes multiple AGENTS.md files in order", () => {
    const prompt = buildSystemPrompt({
      cwd: "/project/src",
      date: "2026-04-05",
      agentsMd: [
        { path: "/project/AGENTS.md", content: "Root rules" },
        { path: "/project/src/AGENTS.md", content: "Src rules" },
      ],
    });

    const rootIdx = prompt.indexOf("Root rules");
    const srcIdx = prompt.indexOf("Src rules");
    expect(rootIdx).toBeGreaterThan(-1);
    expect(srcIdx).toBeGreaterThan(rootIdx);
  });

  test("includes skill catalog when skills provided", () => {
    const skills: Skill[] = [
      {
        name: "deploy",
        description: "Deploy the app.",
        path: "/project/.agents/skills/deploy/SKILL.md",
      },
    ];

    const prompt = buildSystemPrompt({
      cwd: "/project",
      date: "2026-04-05",
      skills,
    });

    expect(prompt).toContain("<available_skills>");
    expect(prompt).toContain("<name>deploy</name>");
  });

  test("includes plugin suffixes when provided", () => {
    const prompt = buildSystemPrompt({
      cwd: "/project",
      date: "2026-04-05",
      pluginSuffixes: [
        "MCP server connected: github",
        "Custom tool: jira-query",
      ],
    });

    expect(prompt).toContain("MCP server connected: github");
    expect(prompt).toContain("Custom tool: jira-query");
  });

  test("assembly order: base → agents.md → skills → plugins → footer", () => {
    const skills: Skill[] = [
      {
        name: "test",
        description: "Test skill.",
        path: "/path/SKILL.md",
      },
    ];

    const prompt = buildSystemPrompt({
      cwd: "/project",
      date: "2026-04-05",
      agentsMd: [{ path: "/project/AGENTS.md", content: "Project rules" }],
      skills,
      pluginSuffixes: ["Plugin context here"],
      git: {
        root: "/project",
        branch: "main",
        staged: 0,
        modified: 0,
        untracked: 0,
        ahead: 0,
        behind: 0,
      },
    });

    // Verify ordering
    const baseIdx = prompt.indexOf("You are mini-coder");
    const agentsIdx = prompt.indexOf("Project rules");
    const skillsIdx = prompt.indexOf("<available_skills>");
    const pluginIdx = prompt.indexOf("Plugin context here");
    const footerIdx = prompt.indexOf("Current date:");

    expect(baseIdx).toBeGreaterThan(-1);
    expect(agentsIdx).toBeGreaterThan(baseIdx);
    expect(skillsIdx).toBeGreaterThan(agentsIdx);
    expect(pluginIdx).toBeGreaterThan(skillsIdx);
    expect(footerIdx).toBeGreaterThan(pluginIdx);
  });

  test("does not mention readImage in base instructions", () => {
    const prompt = buildSystemPrompt({
      cwd: "/project",
      date: "2026-04-05",
    });

    expect(prompt).not.toContain("readImage");
  });
});
