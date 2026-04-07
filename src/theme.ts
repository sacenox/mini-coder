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
  /** Status pill foreground. */
  statusText: ThemeColor;
  /** Primary status pill background (outer pills: model/effort + usage/context/cost). */
  statusPrimaryBg: ThemeColor;
  /** Secondary status pill background (inner pills: CWD + git). */
  statusSecondaryBg: ThemeColor;
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
 * dark terminal themes without any configuration. The outer status pills
 * use a blue primary background, the inner pills use a dim gray secondary
 * background, and bright text keeps the badges readable.
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
  statusText: "color15",
  statusPrimaryBg: "color04",
  statusSecondaryBg: "color08",
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
 * Returns a new {@link Theme}; the base is not mutated.
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
