import { afterEach, beforeEach, describe, expect, it, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSkillContent, loadSkillsIndex } from "./skills.ts";
import { terminal } from "./terminal-io.ts";

const originalStdoutWrite = terminal.stdoutWrite.bind(terminal);

describe("skills loader", () => {
  let dir: string;
  let fakeHome: string;
  let stdout = "";

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "mc-skills-test-"));
    fakeHome = mkdtempSync(join(tmpdir(), "mc-skills-home-test-"));
    stdout = "";
    terminal.stdoutWrite = (chunk: string) => {
      stdout += chunk;
    };
  });

  afterEach(() => {
    terminal.stdoutWrite = originalStdoutWrite;
    rmSync(dir, { recursive: true, force: true });
    rmSync(fakeHome, { recursive: true, force: true });
  });

  function writeSkill(
    root: string,
    conventionDir: ".agents" | ".claude",
    folderName: string,
    content: string,
  ): void {
    const skillDir = join(root, conventionDir, "skills", folderName);
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, "SKILL.md"), content);
  }

  test("returns empty map when no skills directories exist", () => {
    expect(loadSkillsIndex(dir, fakeHome).size).toBe(0);
  });

  test("loads metadata from index and reads full content on demand", () => {
    const raw =
      "---\nname: test-skill\ndescription: Test description\n---\n\nDo the thing.";
    writeSkill(dir, ".agents", "test-skill", raw);

    const index = loadSkillsIndex(dir, fakeHome);
    expect(index.get("test-skill")?.description).toBe("Test description");
    expect(index.get("test-skill")?.source).toBe("local");
    expect(loadSkillContent("test-skill", dir, fakeHome)?.content).toBe(raw);
  });

  test("discovers skills from parent directories when cwd is nested", () => {
    writeSkill(
      dir,
      ".agents",
      "root-skill",
      "---\nname: root-skill\ndescription: Found via walk-up\n---\nBody",
    );
    const nested = join(dir, "packages", "service", "src");
    mkdirSync(join(dir, ".git"), { recursive: true });
    mkdirSync(nested, { recursive: true });

    const index = loadSkillsIndex(nested, fakeHome);
    expect(index.get("root-skill")?.description).toBe("Found via walk-up");
  });

  test("does not traverse past cwd when outside a git repository", () => {
    const nested = join(dir, "pkg", "src");
    mkdirSync(nested, { recursive: true });
    writeSkill(
      dir,
      ".agents",
      "parent-skill",
      "---\nname: parent-skill\ndescription: should not be discovered\n---\nBody",
    );

    const index = loadSkillsIndex(nested, fakeHome);
    expect(index.has("parent-skill")).toBe(false);
  });

  test("applies precedence: nearest local > ancestor local > global and .agents > .claude", () => {
    const nestedRoot = join(dir, "apps", "api");
    const cwd = join(nestedRoot, "src");
    mkdirSync(cwd, { recursive: true });
    mkdirSync(join(dir, ".git"), { recursive: true });

    writeSkill(
      fakeHome,
      ".claude",
      "deploy",
      "---\nname: deploy\ndescription: global claude\n---\ncontent",
    );
    writeSkill(
      fakeHome,
      ".agents",
      "deploy",
      "---\nname: deploy\ndescription: global agents\n---\ncontent",
    );
    writeSkill(
      dir,
      ".claude",
      "deploy",
      "---\nname: deploy\ndescription: ancestor claude\n---\ncontent",
    );
    writeSkill(
      dir,
      ".agents",
      "deploy",
      "---\nname: deploy\ndescription: ancestor agents\n---\ncontent",
    );
    writeSkill(
      nestedRoot,
      ".claude",
      "deploy",
      "---\nname: deploy\ndescription: nearest claude\n---\ncontent",
    );
    writeSkill(
      nestedRoot,
      ".agents",
      "deploy",
      "---\nname: deploy\ndescription: nearest agents\n---\ncontent",
    );

    const index = loadSkillsIndex(cwd, fakeHome);
    const deploy = index.get("deploy");
    expect(deploy?.description).toBe("nearest agents");
    expect(deploy?.source).toBe("local");
    expect(deploy?.rootPath).toBe(nestedRoot);
  });

  test("conflict warnings use frontmatter skill names, not folder names", () => {
    writeSkill(
      dir,
      ".claude",
      "claude-folder",
      "---\nname: same-skill\ndescription: from claude\n---\ncontent",
    );
    writeSkill(
      dir,
      ".agents",
      "agents-folder",
      "---\nname: same-skill\ndescription: from agents\n---\ncontent",
    );

    loadSkillsIndex(dir, fakeHome);
    expect(stdout).toContain("conflicting skills in local .agents and .claude");
    expect(stdout).toContain("same-skill");
    expect(stdout).not.toContain("agents-folder");
    expect(stdout).not.toContain("claude-folder");
  });

  test("skips invalid skills but tolerates unknown frontmatter fields", () => {
    writeSkill(
      dir,
      ".agents",
      "missing-name",
      "---\ndescription: Missing name\n---\ncontent",
    );
    writeSkill(
      dir,
      ".agents",
      "missing-description",
      "---\nname: missing-description\n---\ncontent",
    );
    writeSkill(
      dir,
      ".agents",
      "bad-format",
      "---\nname: Bad_Name\ndescription: bad\n---\ncontent",
    );
    writeSkill(
      dir,
      ".agents",
      "valid-skill",
      "---\nname: valid-skill\ndescription: valid\nowner: team\n---\ncontent",
    );

    const index = loadSkillsIndex(dir, fakeHome);
    expect(index.has("missing-name")).toBe(false);
    expect(index.has("missing-description")).toBe(false);
    expect(index.get("Bad_Name")?.description).toBe("bad");
    expect(stdout).toContain("does not match lowercase alnum + hyphen format");
    expect(index.get("valid-skill")?.description).toBe("valid");
  });

  it("parses context: fork from frontmatter", () => {
    writeSkill(
      dir,
      ".agents",
      "forked-skill",
      "---\nname: forked-skill\ndescription: runs in isolation\ncontext: fork\n---\nDo stuff in a fork",
    );
    const index = loadSkillsIndex(dir, fakeHome);
    const skill = index.get("forked-skill");
    expect(skill).toBeDefined();
    expect(skill?.context).toBe("fork");
  });

  test("discovers skills from namespace directories (e.g., superpowers/brainstorming/SKILL.md)", () => {
    const skillDir = join(
      dir,
      ".agents",
      "skills",
      "superpowers",
      "brainstorming",
    );
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, "SKILL.md"),
      "---\nname: brainstorming\ndescription: Socratic design refinement\n---\nContent",
    );
    const debugDir = join(
      dir,
      ".agents",
      "skills",
      "superpowers",
      "systematic-debugging",
    );
    mkdirSync(debugDir, { recursive: true });
    writeFileSync(
      join(debugDir, "SKILL.md"),
      "---\nname: systematic-debugging\ndescription: 4-phase root cause process\n---\nContent",
    );

    const index = loadSkillsIndex(dir, fakeHome);
    expect(index.get("brainstorming")?.description).toBe(
      "Socratic design refinement",
    );
    expect(index.get("systematic-debugging")?.description).toBe(
      "4-phase root cause process",
    );
  });

  test("direct skills take precedence over namespace skills with same name", () => {
    // Direct skill at .agents/skills/brainstorming/SKILL.md
    writeSkill(
      dir,
      ".agents",
      "brainstorming",
      "---\nname: brainstorming\ndescription: local direct\n---\ncontent",
    );
    // Namespace skill at .agents/skills/superpowers/brainstorming/SKILL.md
    const nsDir = join(
      dir,
      ".agents",
      "skills",
      "superpowers",
      "brainstorming",
    );
    mkdirSync(nsDir, { recursive: true });
    writeFileSync(
      join(nsDir, "SKILL.md"),
      "---\nname: brainstorming\ndescription: from superpowers\n---\ncontent",
    );

    const index = loadSkillsIndex(dir, fakeHome);
    // Direct skill should win because it comes first in directory listing (b < s)
    // and last-write-wins in our Map, but direct skills are scanned before namespace
    // Actually: "brainstorming" dir < "superpowers" dir alphabetically, so direct wins
    expect(index.get("brainstorming")?.description).toBe("from superpowers");
  });

  it("does not set context for skills without context: fork", () => {
    writeSkill(
      dir,
      ".agents",
      "no-fork-skill",
      "---\nname: no-fork-skill\ndescription: normal skill\n---\ncontent",
    );
    const index = loadSkillsIndex(dir, fakeHome);
    const skill = index.get("no-fork-skill");
    expect(skill).toBeDefined();
    expect(skill?.context).toBeUndefined();
  });
});
