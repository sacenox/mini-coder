/**
 * Shared text-shaping helpers.
 *
 * @module
 */

/**
 * Collapse whitespace runs to single spaces and trim the ends.
 *
 * @param text - Raw text to normalize.
 * @returns The collapsed single-line text.
 */
export function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Collapse whitespace into a single line, returning `null` when nothing remains.
 *
 * @param text - Raw text to normalize.
 * @returns Collapsed text, or `null` when the result is empty.
 */
export function collapseWhitespaceToNull(text: string): string | null {
  const collapsed = collapseWhitespace(text);
  return collapsed.length > 0 ? collapsed : null;
}

/**
 * Join only `text` blocks from multipart content into one space-separated string.
 *
 * @param content - Multipart content blocks.
 * @returns Concatenated text-block content.
 */
export function joinTextBlocks<T extends { type: string }>(
  content: readonly T[],
): string {
  return content
    .flatMap((block) => {
      return block.type === "text" &&
        "text" in block &&
        typeof block.text === "string"
        ? [block.text]
        : [];
    })
    .join(" ");
}

/**
 * Truncate text with an ellipsis from the start or end.
 *
 * @param text - Text to truncate.
 * @param maxChars - Maximum visible characters including the ellipsis.
 * @param side - Which side to truncate from.
 * @returns Truncated text when needed.
 */
export function truncateText(
  text: string,
  maxChars: number,
  side: "start" | "end" = "end",
): string {
  if (text.length <= maxChars) {
    return text;
  }
  if (maxChars <= 1) {
    return "…";
  }
  if (side === "start") {
    return `…${text.slice(text.length - (maxChars - 1))}`;
  }
  return `${text.slice(0, maxChars - 1)}…`;
}
