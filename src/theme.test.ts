import { describe, expect, test } from "bun:test";
import { DEFAULT_THEME, getSyntaxHighlightTheme } from "./theme.ts";

describe("theme", () => {
  test("getSyntaxHighlightTheme reuses registrations per variant and keeps code distinct from shell", () => {
    const markdown = getSyntaxHighlightTheme(DEFAULT_THEME, "markdown");
    const markdownAgain = getSyntaxHighlightTheme(DEFAULT_THEME, "markdown");
    const code = getSyntaxHighlightTheme(DEFAULT_THEME, "code");
    const shell = getSyntaxHighlightTheme(DEFAULT_THEME, "shell");

    expect(markdownAgain).toBe(markdown);
    expect(markdown.name).toBe("mini-coder-markdown");
    expect(code.name).toBe("mini-coder-code");
    expect(shell.name).toBe("mini-coder-shell");
    expect(code).not.toBe(shell);
  });
});
