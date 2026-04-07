import { describe, expect, test } from "bun:test";
import { DEFAULT_THEME, mergeThemes } from "./theme.ts";

const THEME_KEYS = [
  "userMsgBg",
  "mutedText",
  "accentText",
  "secondaryAccentText",
  "toolBorder",
  "toolText",
  "diffAdded",
  "diffRemoved",
  "divider",
  "dividerPulse",
  "statusText",
  "statusPrimaryBg",
  "statusSecondaryBg",
  "error",
  "overlayBg",
] as const;

describe("theme", () => {
  test("DEFAULT_THEME has all required keys", () => {
    expect(Object.keys(DEFAULT_THEME).sort()).toEqual([...THEME_KEYS].sort());
  });

  test("DEFAULT_THEME uses explicit ANSI16 colors for status pills", () => {
    expect(DEFAULT_THEME.statusText).toBe("color15");
    expect(DEFAULT_THEME.statusPrimaryBg).toBe("color04");
    expect(DEFAULT_THEME.statusSecondaryBg).toBe("color08");
  });

  test("mergeThemes with no overrides returns base unchanged", () => {
    const result = mergeThemes(DEFAULT_THEME);
    expect(result).toEqual(DEFAULT_THEME);
    expect(result).not.toBe(DEFAULT_THEME); // new object
  });

  test("mergeThemes applies a single partial override", () => {
    const result = mergeThemes(DEFAULT_THEME, { error: "color05" });
    expect(result.error).toBe("color05");
    // Other values preserved
    expect(result.userMsgBg).toBe(DEFAULT_THEME.userMsgBg);
    expect(result.divider).toBe(DEFAULT_THEME.divider);
  });

  test("mergeThemes applies multiple overrides left-to-right", () => {
    const result = mergeThemes(
      DEFAULT_THEME,
      { error: "color03", divider: "color05" },
      { error: "color04" },
    );
    // Last override wins for error
    expect(result.error).toBe("color04");
    // First override preserved for divider (not overridden by second)
    expect(result.divider).toBe("color05");
  });

  test("mergeThemes does not mutate the base theme", () => {
    const baseCopy = { ...DEFAULT_THEME };
    mergeThemes(DEFAULT_THEME, { error: "color09" });
    expect(DEFAULT_THEME).toEqual(baseCopy);
  });
});
