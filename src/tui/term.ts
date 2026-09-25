const COMBINING = /\p{M}/u;

function charWidth(code: number): number {
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

/** An SGR sequence: zero cells wide, so it never affects a row break. */
const SGR = /^\x1b\[[0-9;]*m/;

/**
 * Everything a tool, a file or a model can emit that the terminal would act on
 * but the TUI did not write itself: control bytes and every escape sequence but
 * SGR. Dropped before the text is measured, so a row's width is its visible
 * width and a result can only add rows — never move the cursor, erase the
 * screen, or break the row model. Tabs survive to `expandTabs`, which owns them.
 */
const UNSAFE = /(\x1b\[[0-9;]*m)|\x1b(?:\[[0-9;?]*[ -/]*[@-~]|.)|[\x00-\x08\x0a-\x1f\x7f-\x9f]/g;

export function sanitize(text: string): string {
  return text.replace(UNSAFE, (_match, sgr: string | undefined) => sgr ?? "");
}

export function expandTabs(text: string, size = 4): string {
  if (!text.includes("\t")) return text;
  let column = 0;
  let out = "";
  for (let i = 0; i < text.length; ) {
    const escape = SGR.exec(text.slice(i));
    if (escape !== null) {
      out += escape[0];
      i += escape[0].length;
      continue;
    }
    const ch = String.fromCodePoint(text.codePointAt(i)!);
    i += ch.length;
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

/**
 * Splits one logical line into physical rows no wider than `width` cells. SGR
 * sequences count as zero cells and stay attached to the text that follows.
 */
export function wrapLine(text: string, width: number): string[] {
  if (width <= 0) return [""];
  if (text === "") return [""];
  const rows: string[] = [];
  let current = "";
  let used = 0;
  for (let i = 0; i < text.length; ) {
    if (text.charCodeAt(i) === 0x1b) {
      const escape = SGR.exec(text.slice(i));
      if (escape !== null) {
        current += escape[0];
        i += escape[0].length;
        continue;
      }
    }
    const ch = String.fromCodePoint(text.codePointAt(i)!);
    const w = charWidth(ch.codePointAt(0)!);
    if (used + w > width && current !== "") {
      rows.push(current);
      current = "";
      used = 0;
    }
    current += ch;
    used += w;
    i += ch.length;
  }
  rows.push(current);
  return rows;
}

export type Key =
  | { type: "text"; text: string }
  | { type: "submit" }
  | { type: "newline" }
  | { type: "backspace" }
  | { type: "delete" }
  | { type: "wordBack" }
  | { type: "left" }
  | { type: "right" }
  | { type: "wordLeft" }
  | { type: "wordRight" }
  | { type: "up" }
  | { type: "down" }
  | { type: "home" }
  | { type: "end" }
  | { type: "docStart" }
  | { type: "docEnd" }
  | { type: "tab" }
  | { type: "escape" }
  | { type: "interrupt" }
  | { type: "eof" };

const PASTE_START = "\x1b[200~";
const PASTE_END = "\x1b[201~";

const SHIFT = 1;
const ALT = 2;
const CTRL = 4;
/** Only real modifiers are acted on; lock bits and the rest are ignored. */
const MODS = SHIFT | ALT | CTRL;

/** Codes for keys without a printable form, matching kitty's functional range. */
const CODE = {
  enter: 13,
  escape: 27,
  tab: 9,
  backspace: 127,
  delete: 57349,
  left: 57350,
  right: 57351,
  up: 57352,
  down: 57353,
  home: 57356,
  end: 57357,
} as const;

/** The one table every input path resolves through: code and modifiers to key. */
const KEYS: Record<string, Key | undefined> = {
  [`${CODE.enter}:0`]: { type: "submit" },
  [`${CODE.enter}:${ALT}`]: { type: "newline" },
  [`${CODE.enter}:${SHIFT}`]: { type: "newline" },
  [`${CODE.escape}:0`]: { type: "escape" },
  [`${CODE.tab}:0`]: { type: "tab" },
  [`${CODE.backspace}:0`]: { type: "backspace" },
  [`${CODE.backspace}:${CTRL}`]: { type: "wordBack" },
  [`${CODE.delete}:0`]: { type: "delete" },
  [`${CODE.left}:0`]: { type: "left" },
  [`${CODE.left}:${CTRL}`]: { type: "wordLeft" },
  [`${CODE.right}:0`]: { type: "right" },
  [`${CODE.right}:${CTRL}`]: { type: "wordRight" },
  [`${CODE.up}:0`]: { type: "up" },
  [`${CODE.down}:0`]: { type: "down" },
  [`${CODE.home}:0`]: { type: "home" },
  [`${CODE.home}:${CTRL}`]: { type: "docStart" },
  [`${CODE.end}:0`]: { type: "end" },
  [`${CODE.end}:${CTRL}`]: { type: "docEnd" },
  ["97:4"]: { type: "home" }, // Ctrl+A
  ["98:2"]: { type: "wordBack" }, // Alt+B
  ["99:4"]: { type: "interrupt" }, // Ctrl+C
  ["100:4"]: { type: "eof" }, // Ctrl+D
  ["101:4"]: { type: "end" }, // Ctrl+E
  ["106:4"]: { type: "newline" }, // Ctrl+J
  ["119:4"]: { type: "wordBack" }, // Ctrl+W
};

const CSI_FINALS: Record<string, number | undefined> = {
  A: CODE.up,
  B: CODE.down,
  C: CODE.right,
  D: CODE.left,
  H: CODE.home,
  F: CODE.end,
};

const CSI_TILDES: Record<number, number | undefined> = {
  1: CODE.home,
  3: CODE.delete,
  4: CODE.end,
  7: CODE.home,
  8: CODE.end,
};

interface Chord {
  code: number;
  mods: number;
}

function lookup(code: number, mods: number): Key | null {
  return KEYS[`${code}:${mods}`] ?? null;
}

/** Control bytes are never text: they resolve through the table or vanish. */
function mapPoint(code: number): Key | null {
  if (code === 0x7f) return lookup(CODE.backspace, 0);
  if (code < 0x20) {
    // A legacy control byte, as the chord the same key arrives as elsewhere.
    if (code === 0x08) return lookup(CODE.backspace, 0);
    if (code === 0x09) return lookup(CODE.tab, 0);
    if (code === 0x0d) return lookup(CODE.enter, 0);
    return lookup(code + 0x60, CTRL);
  }
  return { type: "text", text: String.fromCodePoint(code) };
}

function modsOf(field: string | undefined): number {
  const raw = Number.parseInt(field ?? "", 10);
  return Number.isFinite(raw) && raw > 0 ? (raw - 1) & MODS : 0;
}

/** `code[:shifted[:base]];mods[:event];text` */
function csiUChord(params: string): Chord | null {
  const fields = params.split(";");
  const code = Number.parseInt(fields[0].split(":")[0], 10);
  if (!Number.isFinite(code)) return null; // probe replies and private forms
  if (code >= 57344) return null; // functional keys never arrive as CSI-u
  return { code, mods: modsOf(fields[1]?.split(":")[0]) };
}

/** `params final`: the legacy `CSI 1;5D` form and SS3's bare `A`. */
function legacyChord(final: string, params: string): Chord | null {
  const fields = params.split(";");
  const code = final === "~" ? CSI_TILDES[Number.parseInt(fields[0], 10)] : CSI_FINALS[final];
  return code === undefined ? null : { code, mods: modsOf(fields[1]) };
}

function normalizePaste(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

class KeyParser {
  private buffer = "";
  private pasting = false;

  /** What the buffer may still complete: a lone ESC, a partial sequence, or nothing. */
  pending(): "escape" | "sequence" | null {
    if (this.pasting) return null;
    if (this.buffer === "\x1b") return "escape";
    return this.buffer.length > 1 ? "sequence" : null;
  }

  flushEscape(): Key[] {
    if (this.buffer !== "\x1b") return [];
    this.buffer = "";
    return [{ type: "escape" }];
  }

  flushSequence(): void {
    this.buffer = "";
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
      const key = mapPoint(code);
      if (key) keys.push(key);
    }
    return keys;
  }

  private parseEscape(keys: Key[]): boolean {
    const buffer = this.buffer;
    if (buffer.length < 2) return false;
    const next = buffer[1];
    if (next === "[" || next === "O") return this.parseCsi(keys);
    if (next === "]") return this.skipString(true);
    if (next === "P" || next === "X" || next === "^" || next === "_") return this.skipString(false);
    this.buffer = buffer.slice(2);
    const key = lookup(next.codePointAt(0)!, ALT);
    if (key) keys.push(key);
    return true;
  }

  private parseCsi(keys: Key[]): boolean {
    const buffer = this.buffer;
    let i = 2;
    while (i < buffer.length) {
      const code = buffer.charCodeAt(i);
      if (code >= 0x40 && code <= 0x7e) break;
      i++;
    }
    if (i >= buffer.length) return false;
    const final = buffer[i];
    const params = buffer.slice(2, i);
    this.buffer = buffer.slice(i + 1);
    const chord = final === "u" ? csiUChord(params) : legacyChord(final, params);
    if (chord !== null) {
      const key = lookup(chord.code, chord.mods);
      if (key) keys.push(key);
    }
    return true;
  }

  /** OSC ends at BEL or ST; DCS/APC/PM/SOS end at ST. Skipped whole. */
  private skipString(bel: boolean): boolean {
    const st = this.buffer.indexOf("\x1b\\", 2);
    const bell = bel ? this.buffer.indexOf("\x07", 2) : -1;
    let end = -1;
    if (bell >= 0 && (st < 0 || bell < st)) end = bell + 1;
    else if (st >= 0) end = st + 2;
    if (end < 0) return false;
    this.buffer = this.buffer.slice(end);
    return true;
  }
}

interface TerminalHandlers {
  onKey: (key: Key) => void;
  onResize: () => void;
}

export class Terminal {
  private readonly handlers: TerminalHandlers;
  private parser = new KeyParser();
  private escapeTimer: NodeJS.Timeout | undefined;
  private sequenceTimer: NodeJS.Timeout | undefined;
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
    // Bracketed paste, then kitty flag 1 so `Shift+Enter` is distinguishable.
    if (process.stdout.isTTY) process.stdout.write("\x1b[?2004h\x1b[>1u\x1b[?u");
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    this.clearTimers();
    process.stdin.off("data", this.onData);
    process.stdout.off("resize", this.onResize);
    if (process.stdout.isTTY) process.stdout.write("\x1b[<u\x1b[?2004l");
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
    process.stdin.pause();
  }

  write(text: string): void {
    process.stdout.write(text);
  }

  private clearTimers(): void {
    if (this.escapeTimer) clearTimeout(this.escapeTimer);
    if (this.sequenceTimer) clearTimeout(this.sequenceTimer);
    this.escapeTimer = undefined;
    this.sequenceTimer = undefined;
  }

  private onData = (chunk: string): void => {
    // Both timers reset on every chunk, so `Alt`+key stays snappy and an
    // incomplete sequence never wedges the buffer.
    this.clearTimers();
    for (const key of this.parser.feed(chunk)) this.handlers.onKey(key);
    const pending = this.parser.pending();
    if (pending === "escape") {
      this.escapeTimer = setTimeout(() => {
        this.escapeTimer = undefined;
        for (const key of this.parser.flushEscape()) this.handlers.onKey(key);
      }, 30);
    } else if (pending === "sequence") {
      this.sequenceTimer = setTimeout(() => {
        this.sequenceTimer = undefined;
        this.parser.flushSequence();
      }, 150);
    }
  };

  private onResize = (): void => this.handlers.onResize();
}
