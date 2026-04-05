/**
 * UI theme definition and default colors.
 *
 * All UI colors are read from the active {@link Theme} object — the UI
 * never hardcodes colors. Plugins can return a `Partial<Theme>` in their
 * result to override any color. Multiple overrides are merged left-to-right.
 *
 * Theme values are cel-tui color strings (e.g., `"color08"`, `"#ff0000"`).
 *
 * @module
 */

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
  userMsgBg: string;
  /** Tool output left border and text. */
  toolBorder: string;
  /** Tool output text. */
  toolText: string;
  /** Diff added line color (green). */
  diffAdded: string;
  /** Diff removed line color (red). */
  diffRemoved: string;
  /** Divider line color (idle state). */
  divider: string;
  /** Divider scanning pulse highlight color (active state). */
  dividerPulse: string;
  /** Status bar foreground. */
  statusText: string;
  /** Error text. */
  error: string;
}

// ---------------------------------------------------------------------------
// Default theme
// ---------------------------------------------------------------------------

/**
 * The default theme.
 *
 * Uses terminal palette colors so it looks reasonable across light and
 * dark terminal themes without any configuration.
 */
export const DEFAULT_THEME: Theme = {
  userMsgBg: "color08",
  toolBorder: "color08",
  toolText: "color08",
  diffAdded: "color02",
  diffRemoved: "color01",
  divider: "color08",
  dividerPulse: "color07",
  statusText: "color07",
  error: "color01",
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
