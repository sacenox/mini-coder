import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { GitState } from "./git.ts";
import { canonicalizePath } from "./paths.ts";
import {
  buildSystemPrompt,
  discoverAgentsMd,
  formatGitLine,
  resolveAgentsScanRoot,
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
    expect(files[0]!.path).toBe(canonicalizePath(join(tmp, "AGENTS.md")));
    expect(files[0]!.content).toBe("Root instructions");
    expect(files[1]!.path).toBe(
      canonicalizePath(join(tmp, "src", "AGENTS.md")),
    );
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

  test("does not walk above the scan root when cwd uses a symlinked path", () => {
    const project = join(tmp, "project");
    const linkedProject = join(tmp, "linked-project");
    const child = join(linkedProject, "src");

    mkdirSync(join(project, "src"), { recursive: true });
    symlinkSync(project, linkedProject);

    writeFileSync(join(tmp, "AGENTS.md"), "Above root");
    writeFileSync(join(project, "AGENTS.md"), "At root");

    const files = discoverAgentsMd(child, canonicalizePath(project));
    expect(files).toHaveLength(1);
    expect(files[0]!.content).toBe("At root");
  });

  test("includes intermediate AGENTS.md files from the canonical parent chain", () => {
    const home = join(tmp, "home");
    const work = join(home, "work");
    const project = join(work, "project");
    const linkedProject = join(tmp, "project-link");
    const child = join(linkedProject, "src");

    mkdirSync(join(project, "src"), { recursive: true });
    symlinkSync(project, linkedProject);

    writeFileSync(join(home, "AGENTS.md"), "Home instructions");
    writeFileSync(join(work, "AGENTS.md"), "Work instructions");
    writeFileSync(join(project, "AGENTS.md"), "Project instructions");

    const files = discoverAgentsMd(child, home);
    expect(files.map((file) => file.content)).toEqual([
      "Home instructions",
      "Work instructions",
      "Project instructions",
    ]);
  });

  test("does not walk outside cwd when the scan root is not an ancestor", () => {
    const home = join(tmp, "home");
    const project = join(tmp, "outside", "project");

    mkdirSync(home, { recursive: true });
    mkdirSync(project, { recursive: true });

    writeFileSync(join(tmp, "AGENTS.md"), "Tmp instructions");
    writeFileSync(join(project, "AGENTS.md"), "Project instructions");

    const files = discoverAgentsMd(project, home);
    expect(files.map((file) => file.content)).toEqual(["Project instructions"]);
  });

  test("skips unreadable AGENTS.md files", () => {
    const unreadablePath = join(tmp, "AGENTS.md");
    writeFileSync(unreadablePath, "secret instructions");
    chmodSync(unreadablePath, 0o000);

    try {
      expect(discoverAgentsMd(tmp, resolve(tmp))).toEqual([]);
    } finally {
      chmodSync(unreadablePath, 0o600);
    }
  });
});

// ---------------------------------------------------------------------------
// resolveAgentsScanRoot
// ---------------------------------------------------------------------------

describe("resolveAgentsScanRoot", () => {
  test("prefers the git root when one is available", () => {
    const project = join(tmp, "project");
    const home = join(tmp, "home");
    mkdirSync(project, { recursive: true });
    mkdirSync(home, { recursive: true });

    expect(resolveAgentsScanRoot(project, project, home, "/")).toBe(
      canonicalizePath(project),
    );
  });

  test("falls back to the home directory unless MC_AGENTS_ROOT=/ is set", () => {
    const project = join(tmp, "project");
    const home = join(tmp, "home");
    mkdirSync(project, { recursive: true });
    mkdirSync(home, { recursive: true });

    expect(resolveAgentsScanRoot(project, null, home)).toBe(
      canonicalizePath(home),
    );
    expect(resolveAgentsScanRoot(project, null, home, "/")).toBe(
      canonicalizePath("/"),
    );
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
      upstream: "origin/main",
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
      upstream: null,
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
      upstream: null,
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
      upstream: "upstream/dev",
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
      upstream: "origin/main",
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
      upstream: "origin/main",
      staged: 0,
      modified: 0,
      untracked: 0,
      ahead: 0,
      behind: 4,
    };

    const line = formatGitLine(state);
    expect(line).toBe("Git: branch main | −4 vs origin/main");
  });

  test("uses the actual upstream ref instead of assuming origin", () => {
    const state: GitState = {
      root: "/repo",
      branch: "feature",
      upstream: "fork/main",
      staged: 0,
      modified: 0,
      untracked: 0,
      ahead: 2,
      behind: 1,
    };

    const line = formatGitLine(state);
    expect(line).toBe("Git: branch feature | +2 −1 vs fork/main");
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

  test("includes contract, verifier, and exactness guidance", () => {
    const prompt = buildSystemPrompt({
      cwd: "/home/user/project",
      date: "2026-04-05",
    });

    expect(prompt).toContain("First identify the task contract");
    expect(prompt).toContain(
      "look for acceptance criteria in tests, verifier scripts, eval scripts, examples, and expected-output files",
    );
    expect(prompt).toContain("create the required artifact early");
    expect(prompt).toContain(
      "run the smallest targeted verification that checks the exact contract",
    );
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
        upstream: "origin/main",
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
        upstream: null,
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
