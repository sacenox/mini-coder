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

import type { SyntaxHighlightTheme } from "@cel-tui/components";
import type { Color } from "@cel-tui/types";

/** A cel-tui palette color or the terminal default when undefined. */
type ThemeColor = Color | undefined;

type SyntaxThemeRegistration = Exclude<SyntaxHighlightTheme, string>;
type SyntaxThemeTokenColor = NonNullable<
  SyntaxThemeRegistration["tokenColors"]
>[number];
type SyntaxThemeVariant = "markdown" | "code" | "shell";

/** ANSI16 fallback hex values for syntax-highlighter theme overrides. */
const ANSI_COLOR_HEX: Readonly<Record<Color, string>> = {
  color00: "#000000",
  color01: "#cd3131",
  color02: "#0dbc79",
  color03: "#e5e510",
  color04: "#2472c8",
  color05: "#bc3fbc",
  color06: "#11a8cd",
  color07: "#e5e5e5",
  color08: "#666666",
  color09: "#f14c4c",
  color10: "#23d18b",
  color11: "#f5f543",
  color12: "#3b8eea",
  color13: "#d670d6",
  color14: "#29b8db",
  color15: "#ffffff",
};

const syntaxThemeCache: Record<
  SyntaxThemeVariant,
  WeakMap<Theme, SyntaxThemeRegistration>
> = {
  markdown: new WeakMap(),
  code: new WeakMap(),
  shell: new WeakMap(),
};

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
  /** Added/replacement edit preview text. */
  diffAdded: ThemeColor;
  /** Removed/original edit preview text. */
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

function colorToHex(color: ThemeColor): string | undefined {
  return color ? ANSI_COLOR_HEX[color] : undefined;
}

function pushSyntaxTokenColor(
  tokenColors: SyntaxThemeTokenColor[],
  scope: string | readonly string[],
  foreground: ThemeColor,
  fontStyle?: string,
): void {
  const foregroundHex = colorToHex(foreground);
  if (!foregroundHex && !fontStyle) {
    return;
  }

  tokenColors.push({
    scope,
    settings: {
      ...(foregroundHex ? { foreground: foregroundHex } : {}),
      ...(fontStyle ? { fontStyle } : {}),
    },
  });
}

function pushCodeSyntaxTokenColors(
  tokenColors: SyntaxThemeTokenColor[],
  theme: Theme,
): void {
  pushSyntaxTokenColor(
    tokenColors,
    ["comment", "quote", "doctag", "markup.quote"],
    theme.mutedText,
    "italic",
  );
  pushSyntaxTokenColor(
    tokenColors,
    ["keyword", "operator"],
    theme.secondaryAccentText,
  );
  pushSyntaxTokenColor(
    tokenColors,
    ["command", "function_", "function", "title"],
    theme.accentText,
  );
  pushSyntaxTokenColor(
    tokenColors,
    ["builtin", "built_in", "class_", "class", "inherited__", "type"],
    theme.accentText,
  );
  pushSyntaxTokenColor(
    tokenColors,
    ["escape", "literal", "number", "symbol"],
    theme.secondaryAccentText ?? theme.accentText,
  );
  pushSyntaxTokenColor(
    tokenColors,
    ["code", "string", "markup.code"],
    theme.diffAdded,
  );
  pushSyntaxTokenColor(tokenColors, "regexp", theme.diffRemoved);
  pushSyntaxTokenColor(
    tokenColors,
    ["attr", "attribute", "params", "property", "selector-attr"],
    theme.accentText,
  );
  pushSyntaxTokenColor(
    tokenColors,
    [
      "name",
      "tag",
      "selector-class",
      "selector-id",
      "selector-pseudo",
      "selector-tag",
    ],
    theme.accentText,
  );
}

function pushMarkdownSyntaxTokenColors(
  tokenColors: SyntaxThemeTokenColor[],
  theme: Theme,
): void {
  pushSyntaxTokenColor(
    tokenColors,
    ["quote", "markup.quote"],
    theme.mutedText,
    "italic",
  );
  pushSyntaxTokenColor(
    tokenColors,
    ["section", "markup.heading"],
    theme.accentText,
    "bold",
  );
  pushSyntaxTokenColor(
    tokenColors,
    ["bullet", "markup.list"],
    theme.secondaryAccentText,
    "bold",
  );
  pushSyntaxTokenColor(
    tokenColors,
    ["code", "string", "markup.code"],
    theme.diffAdded,
  );
  pushSyntaxTokenColor(tokenColors, "link", theme.accentText, "underline");
  pushSyntaxTokenColor(tokenColors, "strong", undefined, "bold");
  pushSyntaxTokenColor(tokenColors, "emphasis", undefined, "italic");
}

/**
 * Build the shared syntax-highlight theme registration for a UI theme variant.
 *
 * Markdown, read/code blocks, and shell/tool previews all flow through this
 * helper so active-theme overrides stay consistent in one place. Variant names
 * are included in the registration so cel-tui's internal SyntaxHighlight cache
 * does not collapse code and shell renders onto the same custom-theme key.
 *
 * @param theme - Active UI theme.
 * @param variant - Semantic highlighting variant for the rendered content.
 * @returns A cached cel-tui syntax-highlight theme registration.
 */
export function getSyntaxHighlightTheme(
  theme: Theme,
  variant: SyntaxThemeVariant,
): SyntaxThemeRegistration {
  const cache = syntaxThemeCache[variant];
  const cached = cache.get(theme);
  if (cached) {
    return cached;
  }

  const tokenColors: SyntaxThemeTokenColor[] = [];
  if (variant === "markdown") {
    pushMarkdownSyntaxTokenColors(tokenColors, theme);
  } else {
    pushCodeSyntaxTokenColors(tokenColors, theme);
  }

  const syntaxTheme: SyntaxThemeRegistration = {
    name: `mini-coder-${variant}`,
    tokenColors,
  };
  cache.set(theme, syntaxTheme);
  return syntaxTheme;
}
