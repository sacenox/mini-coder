import { describe, expect, test } from "bun:test";
import { DEFAULT_SHOW_REASONING } from "../settings.ts";
import { buildHelpText, type HelpRenderState } from "./help.ts";

describe("ui/help", () => {
  test("buildHelpText formats commands as markdown list items with current state", () => {
    const helpState: HelpRenderState = {
      providers: new Map(),
      model: null,
      agentsMd: [],
      skills: [],
      plugins: [],
      showReasoning: DEFAULT_SHOW_REASONING,
      verbose: false,
    };

    const text = buildHelpText(helpState);

    expect(text).toContain("# Help");
    expect(text).toContain("## Commands");
    expect(text).toContain(
      `- \`/reasoning\` — Toggle thinking display _(currently ${DEFAULT_SHOW_REASONING ? "on" : "off"})_`,
    );
    expect(text).toContain(
      "- `/verbose` — Toggle verbose tool rendering _(currently off)_",
    );
    expect(text).toContain("- `/todo` — Show the current todo list");
  });

  test("buildHelpText lists the supported keyboard shortcuts in markdown", () => {
    const helpState: HelpRenderState = {
      providers: new Map(),
      model: null,
      agentsMd: [],
      skills: [],
      plugins: [],
      showReasoning: DEFAULT_SHOW_REASONING,
      verbose: false,
    };

    const text = buildHelpText(helpState);

    expect(text).toContain("## Keyboard");
    expect(text).toContain("- `Enter` submits the current draft.");
    expect(text).toContain("- `Shift+Enter` inserts a newline.");
    expect(text).toContain(
      "- `Tab` opens command autocomplete when the draft starts with `/`.",
    );
    expect(text).toContain(
      "- Otherwise, `Tab` autocompletes file paths and can open a path picker when there are multiple matches.",
    );
    expect(text).toContain("- `Ctrl+R` opens global input history search.");
    expect(text).toContain(
      "- `Escape` closes the current overlay and returns focus to the input.",
    );
    expect(text).toContain(
      "- With no overlay open, `Escape` interrupts the current turn.",
    );
    expect(text).toContain("- Otherwise, `Escape` does nothing.");
    expect(text).toContain("- `Ctrl+C` exits gracefully.");
    expect(text).toContain("- `Ctrl+D` exits when the input is empty.");
    expect(text).toContain("- `Ctrl+Z` suspends the app to the background.");
    expect(text).not.toContain("Escape blurs the input first");
  });
});
