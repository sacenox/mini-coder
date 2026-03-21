import { describe, expect, test } from "bun:test";
import { parseFrontmatter } from "./frontmatter.ts";

describe("parseFrontmatter", () => {
  test("parses frontmatter with CRLF line endings", () => {
    const raw =
      "---\r\nname: reviewer\r\ndescription: Reviews code\r\nmodel: openai/gpt-5\r\n---\r\n\r\nBe strict.\r\n";
    expect(parseFrontmatter(raw)).toEqual({
      meta: {
        name: "reviewer",
        description: "Reviews code",
        model: "openai/gpt-5",
      },
      body: "Be strict.",
    });
  });

  test("preserves colons inside quoted values", () => {
    const raw =
      '---\ndescription: "Review: fast"\nmodel: "openai/gpt:mini"\n---\n\nPrompt';
    expect(parseFrontmatter(raw)).toEqual({
      meta: {
        description: "Review: fast",
        model: "openai/gpt:mini",
      },
      body: "Prompt",
    });
  });

  test("preserves all frontmatter keys", () => {
    const raw = "---\nname: helper\nfoo: bar\n---\n\nRun it";
    expect(parseFrontmatter(raw)).toEqual({
      meta: {
        name: "helper",
        foo: "bar",
      },
      body: "Run it",
    });
  });

  test("returns the raw input when the closing fence is missing", () => {
    const raw = "---\nname: helper\ndescription: Missing end";
    expect(parseFrontmatter(raw)).toEqual({
      meta: {},
      body: raw,
    });
  });
});
