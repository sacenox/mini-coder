import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverSkills } from "./skills.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "mc-skills-"));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

/** Create a SKILL.md file in a skill directory. */
function writeSkill(basePath: string, name: string, content: string): string {
  const dir = join(basePath, name);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "SKILL.md");
  writeFileSync(path, content);
  return path;
}

// ---------------------------------------------------------------------------
// discoverSkills
// ---------------------------------------------------------------------------

describe("discoverSkills", () => {
  test("discovers skills from a single scan path", () => {
    writeSkill(
      tmp,
      "code-review",
      [
        "---",
        "name: code-review",
        'description: "Review code for bugs."',
        "---",
        "",
        "# Code Review",
        "Do a review.",
      ].join("\n"),
    );

    const skills = discoverSkills([tmp]);
    expect(skills).toHaveLength(1);
    expect(skills[0]!.name).toBe("code-review");
    expect(skills[0]!.description).toBe("Review code for bugs.");
    expect(skills[0]!.path).toBe(join(tmp, "code-review", "SKILL.md"));
  });

  test("project-level skill overrides user-level on name collision", () => {
    // Earlier paths in the array have higher priority (project-level first)
    const project = join(tmp, "project");
    const user = join(tmp, "user");
    writeSkill(
      project,
      "deploy",
      ["---", "name: deploy", "description: Project deploy", "---"].join("\n"),
    );
    writeSkill(
      user,
      "deploy",
      ["---", "name: deploy", "description: User deploy", "---"].join("\n"),
    );

    const skills = discoverSkills([project, user]);
    expect(skills).toHaveLength(1);
    expect(skills[0]!.description).toBe("Project deploy");
    expect(skills[0]!.path).toBe(join(project, "deploy", "SKILL.md"));
  });

  test("uses directory name as fallback when frontmatter name is missing", () => {
    writeSkill(
      tmp,
      "my-tool",
      [
        "---",
        "description: A tool without a name field",
        "---",
        "",
        "# My Tool",
      ].join("\n"),
    );

    const skills = discoverSkills([tmp]);
    expect(skills).toHaveLength(1);
    expect(skills[0]!.name).toBe("my-tool");
    expect(skills[0]!.description).toBe("A tool without a name field");
  });

  test("skips unreadable SKILL.md files", () => {
    const skillPath = writeSkill(
      tmp,
      "secret-skill",
      ["---", "name: secret-skill", "description: Hidden", "---"].join("\n"),
    );
    chmodSync(skillPath, 0o000);

    try {
      expect(discoverSkills([tmp])).toEqual([]);
    } finally {
      chmodSync(skillPath, 0o600);
    }
  });
});
