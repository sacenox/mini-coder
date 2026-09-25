/**
 * The one palette: the TokyoNight `night` slots the TUI uses, from
 * `folke/tokyonight.nvim` (`lua/tokyonight/colors/night.lua` and its generated
 * highlight groups). Every colour the TUI writes comes from here, foreground and
 * background alike, so no row can fall back to the terminal's own colours.
 * Truecolor only.
 */
export const PALETTE = {
  bg: "#1a1b26",
  fg: "#c0caf5",
  fg_dark: "#a9b1d6",
  comment: "#565f89",
  terminal_black: "#414868",
  blue: "#7aa2f7",
  blue1: "#2ac3de",
  blue5: "#89ddff",
  green: "#9ece6a",
  green1: "#73daca",
  magenta: "#bb9af7",
  orange: "#ff9e64",
  purple: "#9d7cd8",
  red: "#f7768e",
  teal: "#1abc9c",
  yellow: "#e0af68",
} as const;

/** `Normal`: the pair every row is painted with, and restored to. */
export const NORMAL_FG = PALETTE.fg;
export const NORMAL_BG = PALETTE.bg;

/** Diff row backgrounds, from the `DiffAdd`/`DiffDelete` groups. */
export const DIFF_ADD = "#243e4a";
export const DIFF_DELETE = "#4a272f";

/** `r;g;b` for one `#rrggbb`. */
export function channels(hex: string): string {
  return [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)).join(";");
}

/**
 * Explicit colour, never a reset: a `39`/`49` or a `0` would hand the rest of
 * the row back to the host terminal, which is the leak this palette closes.
 */
export function sgrFg(hex: string): string {
  return `\x1b[38;2;${channels(hex)}m`;
}

export function sgrBg(hex: string): string {
  return `\x1b[48;2;${channels(hex)}m`;
}

/**
 * Attributes off, then `Normal`. The state a row starts and ends in: bold, dim
 * and the like must not bleed past the span that set them, and a reset (`0`,
 * or a bare colour off) would drop the row back onto the host terminal.
 */
export function sgrPlain(): string {
  return `\x1b[22;23;24;38;2;${channels(NORMAL_FG)};48;2;${channels(NORMAL_BG)}m`;
}

export interface Style {
  fg?: string;
  bg?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
}

/**
 * Capture name to colour, mapped the way `folke/tokyonight.nvim` maps capture
 * names to highlight groups. A dotted name falls back to its parent.
 */
export const STYLES: Record<string, Style | undefined> = {
  comment: { fg: PALETTE.comment },
  constant: { fg: PALETTE.orange },
  "constant.builtin": { fg: PALETTE.blue1 },
  constructor: { fg: PALETTE.magenta },
  escape: { fg: PALETTE.magenta },
  function: { fg: PALETTE.blue },
  "function.builtin": { fg: PALETTE.blue1 },
  "function.method": { fg: PALETTE.blue },
  keyword: { fg: PALETTE.purple },
  number: { fg: PALETTE.orange },
  operator: { fg: PALETTE.blue5 },
  property: { fg: PALETTE.green1 },
  "punctuation.bracket": { fg: PALETTE.fg_dark },
  "punctuation.delimiter": { fg: PALETTE.blue5 },
  "punctuation.special": { fg: PALETTE.blue5 },
  string: { fg: PALETTE.green },
  "string.special": { fg: PALETTE.blue1 },
  type: { fg: PALETTE.blue1 },
  "type.builtin": { fg: "#27a1b9" }, // a per-variant literal, not a palette slot
  variable: { fg: PALETTE.fg },
  "variable.builtin": { fg: PALETTE.red },
  "variable.parameter": { fg: PALETTE.yellow },
  // Markdown's queries predate the `@markup` rename; these are the old names.
  "text.emphasis": { italic: true },
  "text.strong": { bold: true },
  "text.literal": { fg: PALETTE.green },
  "text.uri": { underline: true },
  "text.reference": { fg: PALETTE.blue1 },
};

/**
 * Headings take their level's colour from TokyoNight's rainbow, over a 10% tint
 * of it, as `@markup.heading.N.markdown` does. The grammar's own query names one
 * heading colour for all levels, so the level comes from the marker.
 */
export const HEADINGS: Style[] = [
  { fg: PALETTE.blue, bg: "#24293b" },
  { fg: PALETTE.yellow, bg: "#2e2a2d" },
  { fg: PALETTE.green, bg: "#272d2d" },
  { fg: PALETTE.teal, bg: "#1a2b32" },
  { fg: PALETTE.magenta, bg: "#2a283b" },
  { fg: PALETTE.purple, bg: "#272538" },
  { fg: PALETTE.orange, bg: "#31282c" },
  { fg: PALETTE.red, bg: "#302430" },
].map((style) => ({ ...style, bold: true }));

/** Inline code, `@markup.raw.markdown_inline`. */
export const INLINE_CODE: Style = { fg: PALETTE.blue, bg: PALETTE.terminal_black };
