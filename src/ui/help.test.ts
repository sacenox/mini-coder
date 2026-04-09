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

  test("buildHelpText includes the current Escape input-focus note", () => {
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

    expect(text).toContain("Escape blurs the input first");
    expect(text).toContain("Tab re-focuses the input");
    expect(text).toContain("Escape again interrupts the current turn");
  });
});
