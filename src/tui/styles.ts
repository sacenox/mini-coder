/** Dim foreground (SGR 2), restored to normal intensity (SGR 22). */
export function dim(text: string): string {
  return `\x1b[2m${text}\x1b[22m`;
}

/** Red foreground (SGR 31), restored to the default foreground (SGR 39). */
export function red(text: string): string {
  return `\x1b[31m${text}\x1b[39m`;
}

/** Green foreground (SGR 32), restored to the default foreground (SGR 39). */
export function green(text: string): string {
  return `\x1b[32m${text}\x1b[39m`;
}

/** Yellow foreground (SGR 33), restored to the default foreground (SGR 39). */
export function yellow(text: string): string {
  return `\x1b[33m${text}\x1b[39m`;
}

/** Cyan foreground (SGR 36), restored to the default foreground (SGR 39). */
export function cyan(text: string): string {
  return `\x1b[36m${text}\x1b[39m`;
}
