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
  "statusSecondary",
  "statusEffortScale",
  "statusContextScale",
  "error",
  "overlayBg",
] as const;

describe("theme", () => {
  test("DEFAULT_THEME has all required keys", () => {
    expect(Object.keys(DEFAULT_THEME).sort()).toEqual([...THEME_KEYS].sort());
  });

  test("DEFAULT_THEME uses stepped ANSI16 tones for status pills", () => {
    expect(DEFAULT_THEME.statusSecondary).toEqual({
      fg: "color15",
      bg: "color08",
    });
    expect(DEFAULT_THEME.statusEffortScale).toEqual([
      { fg: "color00", bg: "color02" },
      { fg: "color00", bg: "color06" },
      { fg: "color15", bg: "color05" },
      { fg: "color00", bg: "color09" },
    ]);
    expect(DEFAULT_THEME.statusContextScale).toEqual([
      { fg: "color00", bg: "color02" },
      { fg: "color00", bg: "color06" },
      { fg: "color15", bg: "color05" },
      { fg: "color15", bg: "color01" },
      { fg: "color00", bg: "color09" },
    ]);
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
