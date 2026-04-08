/**
 * UI theme definition and default colors.
 *
 * All UI colors are read from the active {@link Theme} object — the UI
 * never hardcodes colors. Plugins can return a `Partial<Theme>` in their
 * result to override any color. Multiple overrides are merged left-to-right.
 *
 * Theme values are cel-tui {@link Color} palette references. The default
 * theme prefers ANSI 16-color palette entries so it adapts cleanly to the
 * user's terminal theme while still allowing restrained pill styling.
 *
 * @module
 */

import type { Color } from "@cel-tui/types";

/** A cel-tui palette color or the terminal default when undefined. */
type ThemeColor = Color | undefined;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Foreground/background pair for a single status pill tone. */
export interface StatusTone {
  /** Pill foreground color. */
  fg: ThemeColor;
  /** Pill background color. */
  bg: ThemeColor;
}

/**
 * Complete set of UI colors.
 *
 * The default theme uses terminal palette indices so it adapts to the
 * user's terminal color scheme automatically.
 */
export interface Theme {
  /** User message background. */
  userMsgBg: ThemeColor;
  /** Muted informational text, placeholders, and helper copy. */
  mutedText: ThemeColor;
  /** Primary accent for important labels and interactive highlights. */
  accentText: ThemeColor;
  /** Secondary accent for supplementary labels like git status. */
  secondaryAccentText: ThemeColor;
  /** Tool output left border and text. */
  toolBorder: ThemeColor;
  /** Tool output text. */
  toolText: ThemeColor;
  /** Diff added line color (green). */
  diffAdded: ThemeColor;
  /** Diff removed line color (red). */
  diffRemoved: ThemeColor;
  /** Divider line color (idle state). */
  divider: ThemeColor;
  /** Divider scanning pulse highlight color (active state). */
  dividerPulse: ThemeColor;
  /** Neutral status pill tone for the inner CWD/git pills. */
  statusSecondary: StatusTone;
  /** Model/effort pill tones from low/cold to xhigh/warm. */
  statusEffortScale: readonly [StatusTone, StatusTone, StatusTone, StatusTone];
  /** Usage/context pill tones from empty/cold to near-full/hot. */
  statusContextScale: readonly [
    StatusTone,
    StatusTone,
    StatusTone,
    StatusTone,
    StatusTone,
  ];
  /** Error text. */
  error: ThemeColor;
  /** Overlay modal background. */
  overlayBg: ThemeColor;
}

// ---------------------------------------------------------------------------
// Default theme
// ---------------------------------------------------------------------------

/**
 * The default theme.
 *
 * Uses terminal palette colors so it looks reasonable across light and
 * dark terminal themes without any configuration. The inner status pills
 * stay neutral, while the outer pills use stepped ANSI16 tone scales so
 * reasoning effort and context pressure move through green, cyan, purple,
 * and red as they trend from cold/dark to warm/bright.
 */
export const DEFAULT_THEME: Theme = {
  userMsgBg: "color08",
  mutedText: "color08",
  accentText: "color04",
  secondaryAccentText: "color05",
  toolBorder: "color08",
  toolText: "color08",
  diffAdded: "color02",
  diffRemoved: "color01",
  divider: "color08",
  dividerPulse: "color04",
  statusSecondary: {
    fg: "color15",
    bg: "color08",
  },
  statusEffortScale: [
    { fg: "color00", bg: "color02" },
    { fg: "color00", bg: "color06" },
    { fg: "color15", bg: "color05" },
    { fg: "color00", bg: "color09" },
  ],
  statusContextScale: [
    { fg: "color00", bg: "color02" },
    { fg: "color00", bg: "color06" },
    { fg: "color15", bg: "color05" },
    { fg: "color15", bg: "color01" },
    { fg: "color00", bg: "color09" },
  ],
  error: "color01",
  overlayBg: "color08",
};

// ---------------------------------------------------------------------------
// Theme merging
// ---------------------------------------------------------------------------

/**
 * Merge partial theme overrides on top of a base theme.
 *
 * Applies overrides left-to-right — later overrides win for the same key.
 * This is a shallow merge, so nested status tones and tone scales are
 * replaced as whole values. Returns a new {@link Theme}; the base is not
 * mutated.
 *
 * @param base - The base theme to start from.
 * @param overrides - Partial theme objects to merge (from plugins).
 * @returns A complete {@link Theme} with all overrides applied.
 */
export function mergeThemes(
  base: Theme,
  ...overrides: Partial<Theme>[]
): Theme {
  let merged = { ...base };
  for (const override of overrides) {
    merged = { ...merged, ...override };
  }
  return merged;
}
