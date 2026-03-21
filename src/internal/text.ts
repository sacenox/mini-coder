/** Truncate a plain-text string to `max` characters, appending `…` if clipped. */
export function truncateText(value: string, max: number): string {
  if (value.length <= max) return value;
  if (max <= 1) return "…";
  return `${value.slice(0, max - 1)}…`;
}
