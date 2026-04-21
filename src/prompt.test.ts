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
import { canonicalizePath } from "./paths.ts";
import {
  buildSystemPrompt,
  discoverAgentsMd,
  resolveAgentsScanRoot,
} from "./prompt.ts";

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
// buildSystemPrompt
// ---------------------------------------------------------------------------

describe("buildSystemPrompt", () => {
  test("emphasizes delivering the live end state and re-checking explicit deliverables", () => {
    const prompt = buildSystemPrompt({
      cwd: "/tmp/project",
      modelLabel: "openai-codex/gpt-5.4",
      os: "linux",
      shell: "bash",
    });

    expect(prompt).toContain(
      "Prefer the smallest path that leaves the requested end state already true; do not stop at helper scripts, instructions, or half-finished setup when the user asked for the live result itself.",
    );
    expect(prompt).toContain(
      "Before you finish, re-check the explicit deliverables and current state. If the user named files, paths, ports, services, commands, or output values, make sure they already exist and work now.",
    );
    expect(prompt).toContain(
      "If the request includes structural constraints on files or outputs (for example allowed commands, required lines, exact formats, or counts), treat those as acceptance criteria too and verify them directly against what you produced, not just through downstream behavior.",
    );
    expect(prompt).toContain(
      "Treat concrete command sequences and expected outputs in the user's request as acceptance criteria for the end state. If you verify that flow during the task, do not roll the environment back afterward unless the user explicitly asked for a reset.",
    );
    expect(prompt).toContain(
      "If a check or tool result contradicts your expectation, trust the evidence and resolve the mismatch before you answer.",
    );
    expect(prompt).toContain(
      "When multiple outputs or end states seem plausible, do not guess or swap in a cleaner alternative after verification. Run the smallest check that distinguishes them, and if you change the state later, verify again.",
    );
    expect(prompt).toContain(
      "Use the `delegate` tool for bounded subtasks when another focused agent pass would help.",
    );
    expect(prompt).toContain(
      "Prefer `delegate` over shelling out to `mc -p` unless you specifically need to exercise the CLI itself.",
    );
    expect(prompt).toContain(
      "Do not re-delegate the whole task, spin on repeated self-review prompts, or ask a delegated child to delegate again.",
    );
  });
});
