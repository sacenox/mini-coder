import { describe, expect, test } from "bun:test";
import { DEFAULT_SHOW_REASONING } from "../settings.ts";
import { buildHelpText, type HelpRenderState } from "./help.ts";

describe("ui/help", () => {
  test("buildHelpText includes current reasoning and verbose state", () => {
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

    expect(text).toContain(
      `/reasoning  Toggle thinking display (currently ${DEFAULT_SHOW_REASONING ? "on" : "off"})`,
    );
    expect(text).toContain(
      "/verbose  Toggle verbose tool rendering (currently off)",
    );
  });

  test("buildHelpText describes the current Escape behavior", () => {
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

    expect(text).toContain(
      "Escape closes the current overlay and returns focus to the input",
    );
    expect(text).toContain(
      "With no overlay open, Escape interrupts the current turn",
    );
    expect(text).toContain("Otherwise Escape does nothing");
    expect(text).not.toContain("Escape blurs the input first");
  });
});
