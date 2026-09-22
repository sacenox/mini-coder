const COMBINING = /\p{M}/u;

function charWidth(code: number): number {
  if (code === 0) return 0;
  if (code < 32 || (code >= 0x7f && code < 0xa0)) return 0;
  if (code === 0x200b || code === 0x200c || code === 0x200d || code === 0xfeff) return 0;
  if (code >= 0xfe00 && code <= 0xfe0f) return 0;
  if (code >= 0xe0100 && code <= 0xe01ef) return 0;
  if (COMBINING.test(String.fromCodePoint(code))) return 0;
  if (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0x303e) ||
    (code >= 0x3041 && code <= 0x33ff) ||
    (code >= 0x3400 && code <= 0x4dbf) ||
    (code >= 0x4e00 && code <= 0x9fff) ||
    (code >= 0xa000 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe10 && code <= 0xfe19) ||
    (code >= 0xfe30 && code <= 0xfe6f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x1f300 && code <= 0x1faff) ||
    (code >= 0x20000 && code <= 0x3fffd)
  ) {
    return 2;
  }
  return 1;
}

export function displayWidth(text: string): number {
  let width = 0;
  for (const ch of text) width += charWidth(ch.codePointAt(0)!);
  return width;
}

export function expandTabs(text: string, size = 4): string {
  if (!text.includes("\t")) return text;
  let column = 0;
  let out = "";
  for (const ch of text) {
    if (ch === "\t") {
      const spaces = size - (column % size);
      out += " ".repeat(spaces);
      column += spaces;
    } else {
      out += ch;
      column += charWidth(ch.codePointAt(0)!);
    }
  }
  return out;
}

/** Splits one logical line into physical rows no wider than `width` cells. */
export function wrapLine(text: string, width: number): string[] {
  if (width <= 0) return [""];
  if (text === "") return [""];
  const rows: string[] = [];
  let current = "";
  let used = 0;
  for (const ch of text) {
    const w = charWidth(ch.codePointAt(0)!);
    if (used + w > width && current !== "") {
      rows.push(current);
      current = "";
      used = 0;
    }
    current += ch;
    used += w;
  }
  rows.push(current);
  return rows;
}

export type Key =
  | { type: "text"; text: string }
  | { type: "enter" }
  | { type: "newline" }
  | { type: "backspace" }
  | { type: "delete" }
  | { type: "left" }
  | { type: "right" }
  | { type: "up" }
  | { type: "down" }
  | { type: "home" }
  | { type: "end" }
  | { type: "wordBack" }
  | { type: "tab" }
  | { type: "escape" }
  | { type: "interrupt" }
  | { type: "eof" };

const PASTE_START = "\x1b[200~";
const PASTE_END = "\x1b[201~";

function normalizePaste(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

function mapChar(ch: string): Key | null {
  switch (ch) {
    case "\r":
      return { type: "enter" };
    case "\n":
      return { type: "newline" };
    case "\x7f":
    case "\x08":
      return { type: "backspace" };
    case "\t":
      return { type: "tab" };
    case "\x01":
      return { type: "home" };
    case "\x05":
      return { type: "end" };
    case "\x17":
      return { type: "wordBack" };
    case "\x03":
      return { type: "interrupt" };
    case "\x04":
      return { type: "eof" };
    default:
      return null;
  }
}

function mapCsi(seq: string): Key | null {
  const last = seq[seq.length - 1];
  if (last === "A") return { type: "up" };
  if (last === "B") return { type: "down" };
  if (last === "C") return { type: "right" };
  if (last === "D") return { type: "left" };
  if (last === "H") return { type: "home" };
  if (last === "F") return { type: "end" };
  if (last === "~") {
    const code = Number.parseInt(seq.slice(2, -1), 10);
    if (code === 1 || code === 7) return { type: "home" };
    if (code === 4 || code === 8) return { type: "end" };
    if (code === 3) return { type: "delete" };
  }
  return null;
}

export class KeyParser {
  private buffer = "";
  private pasting = false;

  pendingEscape(): boolean {
    return !this.pasting && this.buffer === "\x1b";
  }

  flushEscape(): Key[] {
    if (this.buffer !== "\x1b") return [];
    this.buffer = "";
    return [{ type: "escape" }];
  }

  feed(chunk: string): Key[] {
    this.buffer += chunk;
    const keys: Key[] = [];
    for (;;) {
      if (this.pasting) {
        const end = this.buffer.indexOf(PASTE_END);
        if (end >= 0) {
          if (end > 0) keys.push({ type: "text", text: normalizePaste(this.buffer.slice(0, end)) });
          this.buffer = this.buffer.slice(end + PASTE_END.length);
          this.pasting = false;
          continue;
        }
        if (this.buffer.length > PASTE_END.length) {
          const keep = PASTE_END.length - 1;
          const emit = this.buffer.slice(0, this.buffer.length - keep);
          this.buffer = this.buffer.slice(this.buffer.length - keep);
          if (emit) keys.push({ type: "text", text: normalizePaste(emit) });
        }
        break;
      }

      if (this.buffer === "") break;
      if (this.buffer.startsWith(PASTE_START)) {
        this.buffer = this.buffer.slice(PASTE_START.length);
        this.pasting = true;
        continue;
      }
      if (this.buffer[0] === "\x1b") {
        if (!this.parseEscape(keys)) break;
        continue;
      }

      const code = this.buffer.codePointAt(0)!;
      const ch = String.fromCodePoint(code);
      this.buffer = this.buffer.slice(ch.length);
      const key = mapChar(ch);
      if (key) keys.push(key);
      else if (code >= 0x20 && code !== 0x7f) keys.push({ type: "text", text: ch });
    }
    return keys;
  }

  private parseEscape(keys: Key[]): boolean {
    const buffer = this.buffer;
    if (buffer.length < 2) return false;
    const next = buffer[1];
    if (next === "[" || next === "O") {
      let i = 2;
      while (i < buffer.length) {
        const code = buffer.charCodeAt(i);
        if (code >= 0x40 && code <= 0x7e) break;
        i++;
      }
      if (i >= buffer.length) return false;
      const seq = buffer.slice(0, i + 1);
      this.buffer = buffer.slice(i + 1);
      const key = mapCsi(seq);
      if (key) keys.push(key);
      return true;
    }
    const ch = buffer[1];
    this.buffer = buffer.slice(2);
    if (ch === "\r" || ch === "\n") keys.push({ type: "newline" });
    else if (ch === "b" || ch === "B") keys.push({ type: "wordBack" });
    return true;
  }
}

export interface TerminalHandlers {
  onKey: (key: Key) => void;
  onResize: () => void;
}

export class Terminal {
  private readonly handlers: TerminalHandlers;
  private parser = new KeyParser();
  private escapeTimer: NodeJS.Timeout | undefined;
  private started = false;

  constructor(handlers: TerminalHandlers) {
    this.handlers = handlers;
  }

  get width(): number {
    return process.stdout.columns && process.stdout.columns > 0 ? process.stdout.columns : 80;
  }

  get height(): number {
    return process.stdout.rows && process.stdout.rows > 0 ? process.stdout.rows : 24;
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    process.stdin.setEncoding("utf8");
    if (process.stdin.isTTY) process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on("data", this.onData);
    process.stdout.on("resize", this.onResize);
    process.stdout.write("\x1b[?2004h");
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    if (this.escapeTimer) clearTimeout(this.escapeTimer);
    process.stdin.off("data", this.onData);
    process.stdout.off("resize", this.onResize);
    process.stdout.write("\x1b[?2004l");
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
    process.stdin.pause();
  }

  write(text: string): void {
    process.stdout.write(text);
  }

  private onData = (chunk: string): void => {
    if (this.escapeTimer) {
      clearTimeout(this.escapeTimer);
      this.escapeTimer = undefined;
    }
    for (const key of this.parser.feed(chunk)) this.handlers.onKey(key);
    if (this.parser.pendingEscape()) {
      this.escapeTimer = setTimeout(() => {
        this.escapeTimer = undefined;
        for (const key of this.parser.flushEscape()) this.handlers.onKey(key);
      }, 30);
    }
  };

  private onResize = (): void => {
    this.handlers.onResize();
  };
}
