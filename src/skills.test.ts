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
import { buildSkillCatalog, discoverSkills, type Skill } from "./skills.ts";

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

  test("discovers skills from multiple scan paths", () => {
    const path1 = join(tmp, "scan1");
    const path2 = join(tmp, "scan2");
    writeSkill(
      path1,
      "skill-a",
      ["---", "name: skill-a", "description: First skill", "---"].join("\n"),
    );
    writeSkill(
      path2,
      "skill-b",
      ["---", "name: skill-b", "description: Second skill", "---"].join("\n"),
    );

    const skills = discoverSkills([path1, path2]);
    expect(skills).toHaveLength(2);
    const names = skills.map((s) => s.name);
    expect(names).toContain("skill-a");
    expect(names).toContain("skill-b");
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

  test("ignores directories without SKILL.md", () => {
    mkdirSync(join(tmp, "no-skill"), { recursive: true });
    writeFileSync(join(tmp, "no-skill", "README.md"), "not a skill");
    writeSkill(
      tmp,
      "real-skill",
      ["---", "name: real-skill", "description: A real skill", "---"].join(
        "\n",
      ),
    );

    const skills = discoverSkills([tmp]);
    expect(skills).toHaveLength(1);
    expect(skills[0]!.name).toBe("real-skill");
  });

  test("returns empty array when scan paths do not exist", () => {
    const skills = discoverSkills([join(tmp, "nonexistent")]);
    expect(skills).toEqual([]);
  });

  test("returns empty array when scan path has no skill dirs", () => {
    mkdirSync(join(tmp, "empty"), { recursive: true });
    const skills = discoverSkills([join(tmp, "empty")]);
    expect(skills).toEqual([]);
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

  test("uses directory name when no frontmatter exists", () => {
    writeSkill(
      tmp,
      "bare-skill",
      "# Bare Skill\n\nJust content, no frontmatter.\n",
    );

    const skills = discoverSkills([tmp]);
    expect(skills).toHaveLength(1);
    expect(skills[0]!.name).toBe("bare-skill");
    expect(skills[0]!.description).toBe("");
  });

  test("uses empty description when frontmatter has no description", () => {
    writeSkill(
      tmp,
      "nodesc",
      ["---", "name: nodesc", "---", "", "Content only."].join("\n"),
    );

    const skills = discoverSkills([tmp]);
    expect(skills).toHaveLength(1);
    expect(skills[0]!.name).toBe("nodesc");
    expect(skills[0]!.description).toBe("");
  });

  test("handles multi-line description in frontmatter", () => {
    writeSkill(
      tmp,
      "multiline",
      [
        "---",
        "name: multiline",
        "description: >",
        "  A skill with a multi-line",
        "  description that folds.",
        "---",
      ].join("\n"),
    );

    const skills = discoverSkills([tmp]);
    expect(skills).toHaveLength(1);
    expect(skills[0]!.description).toContain("multi-line");
    expect(skills[0]!.description).toContain("description that folds.");
  });

  test("strips quotes from frontmatter values", () => {
    writeSkill(
      tmp,
      "quoted",
      [
        "---",
        'name: "quoted-name"',
        "description: 'A quoted description'",
        "---",
      ].join("\n"),
    );

    const skills = discoverSkills([tmp]);
    expect(skills).toHaveLength(1);
    expect(skills[0]!.name).toBe("quoted-name");
    expect(skills[0]!.description).toBe("A quoted description");
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

// ---------------------------------------------------------------------------
// buildSkillCatalog
// ---------------------------------------------------------------------------

describe("buildSkillCatalog", () => {
  test("returns empty string when no skills", () => {
    expect(buildSkillCatalog([])).toBe("");
  });

  test("generates XML catalog with skill entries", () => {
    const skills: Skill[] = [
      {
        name: "code-review",
        description: "Review code for bugs.",
        path: "/project/.agents/skills/code-review/SKILL.md",
      },
      {
        name: "deploy",
        description: "Deploy the app.",
        path: "/home/user/.agents/skills/deploy/SKILL.md",
      },
    ];

    const catalog = buildSkillCatalog(skills);

    // Verify overall structure
    expect(catalog).toContain("<available_skills>");
    expect(catalog).toContain("</available_skills>");

    // Verify individual skill entries
    expect(catalog).toContain("<name>code-review</name>");
    expect(catalog).toContain(
      "<description>Review code for bugs.</description>",
    );
    expect(catalog).toContain(
      "<location>/project/.agents/skills/code-review/SKILL.md</location>",
    );

    expect(catalog).toContain("<name>deploy</name>");
    expect(catalog).toContain("<description>Deploy the app.</description>");
    expect(catalog).toContain(
      "<location>/home/user/.agents/skills/deploy/SKILL.md</location>",
    );
  });

  test("includes the preamble text", () => {
    const skills: Skill[] = [
      {
        name: "test",
        description: "A test skill.",
        path: "/path/to/SKILL.md",
      },
    ];

    const catalog = buildSkillCatalog(skills);
    expect(catalog).toContain(
      "The following skills provide specialized instructions",
    );
    expect(catalog).toContain("resolve it against the skill directory");
  });
});
