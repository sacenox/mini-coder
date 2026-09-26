import { NORMAL_FG, PALETTE, sgrFg } from "./theme.ts";

/**
 * Inline foreground styling from the palette. The foreground is restored by
 * re-asserting `Normal`'s, never by resetting: the row's background, set by the
 * renderer, must survive, and no cell may fall back to the terminal's colours.
 */
function foreground(text: string, hex: string): string {
  return `${sgrFg(hex)}${text}${sgrFg(NORMAL_FG)}`;
}

/** `Comment`, the colour diff context lines share. */
export function dim(text: string): string {
  return foreground(text, PALETTE.comment);
}

export function red(text: string): string {
  return foreground(text, PALETTE.red);
}

export function green(text: string): string {
  return foreground(text, PALETTE.green);
}

export function yellow(text: string): string {
  return foreground(text, PALETTE.yellow);
}

/** Diff hunk headers; the palette's `blue` sits closest to the old ANSI cyan. */
export function cyan(text: string): string {
  return foreground(text, PALETTE.blue);
}

/** The user's own words; also `Function`, which user rows never collide with. */
export function blue(text: string): string {
  return foreground(text, PALETTE.blue);
}

/** The tool accent: call-line heads. */
export function teal(text: string): string {
  return foreground(text, PALETTE.teal);
}
