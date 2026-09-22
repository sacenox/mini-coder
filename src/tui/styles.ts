/** Dim foreground (SGR 2), restored to normal intensity (SGR 22). */
export function dim(text: string): string {
  return `\x1b[2m${text}\x1b[22m`;
}
