const PASTE_TOKEN_START = 0xe000;
const PASTE_TOKEN_END = 0xf8ff;

export function createPasteToken(
  buf: string,
  pasteTokens: ReadonlyMap<string, string>,
): string {
  for (let code = PASTE_TOKEN_START; code <= PASTE_TOKEN_END; code++) {
    const token = String.fromCharCode(code);
    if (!buf.includes(token) && !pasteTokens.has(token)) return token;
  }
  throw new Error("Too many pasted chunks in a single prompt");
}

export function pasteLabel(text: string): string {
  const lines = text.split("\n");
  const first = lines[0] ?? "";
  const preview = first.length > 40 ? `${first.slice(0, 40)}…` : first;
  const extra = lines.length - 1;
  const more = extra > 0 ? ` +${extra} more line${extra === 1 ? "" : "s"}` : "";
  return `[pasted: "${preview}"${more}]`;
}

function processInputBuffer(
  buf: string,
  pasteTokens: ReadonlyMap<string, string>,
  replacer: (ch: string, pasted: string | undefined) => string,
): string {
  let out = "";
  for (let i = 0; i < buf.length; i++) {
    const ch = buf[i] ?? "";
    out += replacer(ch, pasteTokens.get(ch));
  }
  return out;
}

export function renderInputBuffer(
  buf: string,
  pasteTokens: ReadonlyMap<string, string>,
): string {
  return processInputBuffer(buf, pasteTokens, (ch, pasted) =>
    pasted ? pasteLabel(pasted) : ch,
  );
}

export function expandInputBuffer(
  buf: string,
  pasteTokens: ReadonlyMap<string, string>,
): string {
  return processInputBuffer(buf, pasteTokens, (ch, pasted) => pasted ?? ch);
}

export function pruneInputPasteTokens(
  pasteTokens: ReadonlyMap<string, string>,
  ...buffers: readonly string[]
): Map<string, string> {
  const referenced = buffers.join("");
  const next = new Map<string, string>();
  for (const [token, text] of pasteTokens) {
    if (referenced.includes(token)) next.set(token, text);
  }
  return next;
}

export function getVisualCursor(
  buf: string,
  cursor: number,
  pasteTokens: ReadonlyMap<string, string>,
): number {
  let visual = 0;
  for (let i = 0; i < Math.min(cursor, buf.length); i++) {
    const ch = buf[i] ?? "";
    const pasted = pasteTokens.get(ch);
    visual += pasted ? pasteLabel(pasted).length : 1;
  }
  return visual;
}

export function buildPromptDisplay(
  text: string,
  cursor: number,
  maxLen: number,
): { display: string; cursor: number } {
  const clampedCursor = Math.max(0, Math.min(cursor, text.length));
  if (maxLen <= 0) return { display: "", cursor: 0 };
  if (text.length <= maxLen) return { display: text, cursor: clampedCursor };

  let start = Math.max(0, clampedCursor - maxLen);
  const end = Math.min(text.length, start + maxLen);
  if (end - start < maxLen) start = Math.max(0, end - maxLen);

  let display = text.slice(start, end);
  if (start > 0 && display.length > 0) display = `…${display.slice(1)}`;
  if (end < text.length && display.length > 0)
    display = `${display.slice(0, -1)}…`;

  return {
    display,
    cursor: Math.min(clampedCursor - start, display.length),
  };
}
