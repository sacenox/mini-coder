import { describe, expect, test } from "bun:test";
import { isEmptyUserContent, stripSkillFrontmatter } from "./agent.ts";

describe("ui/agent", () => {
  test("stripSkillFrontmatter removes frontmatter and keeps the skill body", () => {
    const content = [
      "---",
      "name: code-review",
      'description: "Review code for issues"',
      "---",
      "# Review Checklist",
      "- Find bugs",
      "",
    ].join("\n");

    expect(stripSkillFrontmatter(content)).toBe(
      "# Review Checklist\n- Find bugs\n",
    );
  });

  test("stripSkillFrontmatter leaves content without frontmatter unchanged", () => {
    expect(stripSkillFrontmatter("# Skill\nUse this carefully\n")).toBe(
      "# Skill\nUse this carefully\n",
    );
  });

  test("isEmptyUserContent returns true for empty text-only content", () => {
    expect(isEmptyUserContent("   \n\t")).toBe(true);
    expect(
      isEmptyUserContent([
        { type: "text", text: "  " },
        { type: "text", text: "\n" },
      ]),
    ).toBe(true);
  });

  test("isEmptyUserContent returns false when multipart content includes an image", () => {
    expect(
      isEmptyUserContent([
        { type: "text", text: "  " },
        {
          type: "image",
          data: Buffer.from("fake-png-data").toString("base64"),
          mimeType: "image/png",
        },
      ]),
    ).toBe(false);
  });
});
