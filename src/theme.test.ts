import { describe, expect, test } from "bun:test";
import { DEFAULT_THEME, mergeThemes } from "./theme.ts";

describe("theme", () => {
  test("DEFAULT_THEME has all required keys", () => {
    expect(DEFAULT_THEME.userMsgBg).toBeString();
    expect(DEFAULT_THEME.toolBorder).toBeString();
    expect(DEFAULT_THEME.toolText).toBeString();
    expect(DEFAULT_THEME.diffAdded).toBeString();
    expect(DEFAULT_THEME.diffRemoved).toBeString();
    expect(DEFAULT_THEME.divider).toBeString();
    expect(DEFAULT_THEME.dividerPulse).toBeString();
    expect(DEFAULT_THEME.statusText).toBeString();
    expect(DEFAULT_THEME.error).toBeString();
  });

  test("mergeThemes with no overrides returns base unchanged", () => {
    const result = mergeThemes(DEFAULT_THEME);
    expect(result).toEqual(DEFAULT_THEME);
    expect(result).not.toBe(DEFAULT_THEME); // new object
  });

  test("mergeThemes applies a single partial override", () => {
    const result = mergeThemes(DEFAULT_THEME, { error: "#ff0000" });
    expect(result.error).toBe("#ff0000");
    // Other values preserved
    expect(result.userMsgBg).toBe(DEFAULT_THEME.userMsgBg);
    expect(result.divider).toBe(DEFAULT_THEME.divider);
  });

  test("mergeThemes applies multiple overrides left-to-right", () => {
    const result = mergeThemes(
      DEFAULT_THEME,
      { error: "first", divider: "plugin1" },
      { error: "second" },
    );
    // Last override wins for error
    expect(result.error).toBe("second");
    // First override preserved for divider (not overridden by second)
    expect(result.divider).toBe("plugin1");
  });

  test("mergeThemes does not mutate the base theme", () => {
    const baseCopy = { ...DEFAULT_THEME };
    mergeThemes(DEFAULT_THEME, { error: "modified" });
    expect(DEFAULT_THEME).toEqual(baseCopy);
  });
});
