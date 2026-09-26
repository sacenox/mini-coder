import { NORMAL_FG, PALETTE, sgrFg } from "./theme.ts";

/**
 * Inline foreground styling from the palette. The foreground is restored by
 * re-asserting `Normal`'s, never by resetting: the row's background, set by the
 * renderer, must survive, and no cell may fall back to the terminal's colours.
 */
const fg = (hex: string) => (text: string): string => `${sgrFg(hex)}${text}${sgrFg(NORMAL_FG)}`;

/** `Comment`, the colour diff context lines share. */
export const dim = fg(PALETTE.comment);
export const red = fg(PALETTE.red);
export const green = fg(PALETTE.green);
export const yellow = fg(PALETTE.yellow);
/** Diff hunk headers; the palette's `blue` sits closest to the old ANSI cyan. */
export const cyan = fg(PALETTE.blue);
/** The user's own words; also `Function`, which user rows never collide with. */
export const blue = fg(PALETTE.blue);
/** The tool accent: call-line heads. */
export const teal = fg(PALETTE.teal);
