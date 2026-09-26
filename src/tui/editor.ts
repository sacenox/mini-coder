import { displayWidth, expandTabs, wrapLine, type Key } from "./term.ts";

const TAB = 4;
const DEFAULT_WIDTH = 80;

function codePoints(line: string): string[] {
  return Array.from(line);
}

function isSpace(ch: string): boolean {
  return /\s/u.test(ch);
}

/** First code point index of the word before `col`; shared by all word motion. */
function wordStart(cps: string[], col: number): number {
  let i = col;
  while (i > 0 && isSpace(cps[i - 1])) i--;
  while (i > 0 && !isSpace(cps[i - 1])) i--;
  return i;
}

/** Code point index one past the word at or after `col`. */
function wordEnd(cps: string[], col: number): number {
  let i = col;
  while (i < cps.length && isSpace(cps[i])) i++;
  while (i < cps.length && !isSpace(cps[i])) i++;
  return i;
}

interface EditorRender {
  rows: string[];
  cursorRow: number;
  cursorCol: number;
}

export class Editor {
  private lines: string[] = [""];
  private row = 0;
  private col = 0;
  private scroll = 0;
  private width = DEFAULT_WIDTH;
  private masked = false;

  text(): string {
    return this.lines.join("\n");
  }

  /** Renders each character as `*` without changing the underlying text. */
  setMasked(masked: boolean): void {
    this.masked = masked;
  }

  private display(line: string): string {
    return this.masked ? "*".repeat(codePoints(line).length) : line;
  }

  clear(): void {
    this.lines = [""];
    this.row = 0;
    this.col = 0;
    this.scroll = 0;
  }

  setText(text: string): void {
    this.lines = text.split("\n");
    this.row = this.lines.length - 1;
    this.col = codePoints(this.lines[this.row]).length;
    this.scroll = 0;
  }

  handle(key: Key): "submit" | "changed" | "none" {
    switch (key.type) {
      case "submit":
        return "submit";
      case "newline":
        this.insert("\n");
        return "changed";
      case "text":
        this.insert(key.text);
        return "changed";
      case "backspace":
        this.backspace();
        return "changed";
      case "delete":
        this.deleteForward();
        return "changed";
      case "wordBack":
        this.wordBack();
        return "changed";
      case "left":
        this.left();
        return "changed";
      case "right":
        this.right();
        return "changed";
      case "wordLeft":
        this.wordLeft();
        return "changed";
      case "wordRight":
        this.wordRight();
        return "changed";
      case "up":
        this.up();
        return "changed";
      case "down":
        this.down();
        return "changed";
      case "home":
        this.col = 0;
        return "changed";
      case "end":
        this.col = codePoints(this.lines[this.row]).length;
        return "changed";
      case "docStart":
        this.row = 0;
        this.col = 0;
        return "changed";
      case "docEnd":
        this.row = this.lines.length - 1;
        this.col = codePoints(this.lines[this.row]).length;
        return "changed";
      default:
        return "none";
    }
  }

  /** Clipped to `maxRows`, scrolled only as far as the caret requires. */
  render(width: number, maxRows: number): EditorRender {
    this.width = Math.max(1, width);
    const rows: string[] = [];
    let cursorRow = 0;
    let cursorCol = 0;
    for (let line = 0; line < this.lines.length; line++) {
      const chunks = wrapLine(expandTabs(this.display(this.lines[line]), TAB), this.width);
      if (line === this.row) {
        const caret = this.caret();
        cursorRow = rows.length + caret.row;
        cursorCol = caret.col;
      }
      rows.push(...chunks);
    }
    const view = Math.max(1, maxRows);
    if (cursorRow < this.scroll) this.scroll = cursorRow;
    else if (cursorRow >= this.scroll + view) this.scroll = cursorRow - view + 1;
    this.scroll = Math.min(Math.max(this.scroll, 0), Math.max(0, rows.length - view));
    return {
      rows: rows.slice(this.scroll, this.scroll + view),
      cursorRow: cursorRow - this.scroll,
      cursorCol,
    };
  }

  /** The caret's display row within its logical line, and its cell column. */
  private caret(): { row: number; col: number } {
    const line = this.display(this.lines[this.row]);
    const chunks = wrapLine(expandTabs(line, TAB), this.width);
    const cell = this.cells(line)[this.col];
    const row = Math.floor(cell / this.width);
    if (row >= chunks.length) return { row: chunks.length - 1, col: displayWidth(chunks[chunks.length - 1]) };
    return { row, col: cell - row * this.width };
  }

  /** Display column of every code point boundary in `line`, tabs expanded. */
  private cells(line: string): number[] {
    const out = [0];
    let col = 0;
    for (const ch of codePoints(line)) {
      col += ch === "\t" ? TAB - (col % TAB) : displayWidth(ch);
      out.push(col);
    }
    return out;
  }

  /** The caret column nearest `cell`, never past the end of the line. */
  private colAtCell(line: string, cell: number): number {
    const cells = this.cells(line);
    let i = cells.length - 1;
    while (i > 0 && cells[i] > cell) i--;
    return i;
  }

  private insert(text: string): void {
    const parts = text.split("\n");
    const current = codePoints(this.lines[this.row]);
    const before = current.slice(0, this.col).join("");
    const after = current.slice(this.col).join("");
    if (parts.length === 1) {
      this.lines[this.row] = before + parts[0] + after;
      this.col += codePoints(parts[0]).length;
      return;
    }
    const head = before + parts[0];
    const tail = parts[parts.length - 1] + after;
    this.lines.splice(this.row, 1, head, ...parts.slice(1, -1), tail);
    this.row += parts.length - 1;
    this.col = codePoints(parts[parts.length - 1]).length;
  }

  private backspace(): void {
    if (this.col > 0) {
      const current = codePoints(this.lines[this.row]);
      this.lines[this.row] = current.slice(0, this.col - 1).join("") + current.slice(this.col).join("");
      this.col--;
      return;
    }
    if (this.row > 0) {
      const previous = codePoints(this.lines[this.row - 1]).length;
      this.lines[this.row - 1] += this.lines[this.row];
      this.lines.splice(this.row, 1);
      this.row--;
      this.col = previous;
    }
  }

  private deleteForward(): void {
    const current = codePoints(this.lines[this.row]);
    if (this.col < current.length) {
      this.lines[this.row] = current.slice(0, this.col).join("") + current.slice(this.col + 1).join("");
      return;
    }
    if (this.row < this.lines.length - 1) {
      this.lines[this.row] += this.lines[this.row + 1];
      this.lines.splice(this.row + 1, 1);
    }
  }

  private left(): void {
    if (this.col > 0) this.col--;
    else if (this.row > 0) {
      this.row--;
      this.col = codePoints(this.lines[this.row]).length;
    }
  }

  private right(): void {
    if (this.col < codePoints(this.lines[this.row]).length) this.col++;
    else if (this.row < this.lines.length - 1) {
      this.row++;
      this.col = 0;
    }
  }

  /** One display row, so the caret crosses the wrapped rows of a long line. */
  private up(): void {
    const line = this.lines[this.row];
    const caret = this.caret();
    if (caret.row > 0) {
      this.col = this.colAtCell(line, this.cells(line)[this.col] - this.width);
      return;
    }
    if (this.row === 0) return;
    this.row--;
    const previous = this.lines[this.row];
    const lastRow = wrapLine(expandTabs(previous, TAB), this.width).length - 1;
    this.col = this.colAtCell(previous, lastRow * this.width + caret.col);
  }

  private down(): void {
    const line = this.lines[this.row];
    const caret = this.caret();
    if (caret.row < wrapLine(expandTabs(line, TAB), this.width).length - 1) {
      this.col = this.colAtCell(line, this.cells(line)[this.col] + this.width);
      return;
    }
    if (this.row === this.lines.length - 1) return;
    this.row++;
    this.col = this.colAtCell(this.lines[this.row], caret.col);
  }

  private wordLeft(): void {
    const cps = codePoints(this.lines[this.row]);
    const start = wordStart(cps, this.col);
    if (start !== this.col) {
      this.col = start;
      return;
    }
    if (this.row === 0) return;
    this.row--;
    const previous = codePoints(this.lines[this.row]);
    this.col = wordStart(previous, previous.length);
  }

  private wordRight(): void {
    const cps = codePoints(this.lines[this.row]);
    const end = wordEnd(cps, this.col);
    if (end !== this.col) {
      this.col = end;
      return;
    }
    if (this.row === this.lines.length - 1) return;
    this.row++;
    this.col = wordEnd(codePoints(this.lines[this.row]), 0);
  }

  private wordBack(): void {
    const current = codePoints(this.lines[this.row]);
    const start = wordStart(current, this.col);
    this.lines[this.row] = current.slice(0, start).join("") + current.slice(this.col).join("");
    this.col = start;
  }

  /**
   * Applies `step` to the word ending at the caret, replacing it; false when
   * there is no word before the caret. Whitespace is `isSpace` (Unicode `\s`),
   * so a path word may carry `/`, `~`, `.`, `$` — no path-specific separator
   * set. No completion-undo: bash's TAB-_ restore is out; the user backspaces
   * or re-types instead, with Esc and the editor's own keys as recovery.
   */
  completeWord(step: (word: string) => string | null): boolean {
    const current = codePoints(this.lines[this.row]);
    const start = wordStart(current, this.col);
    if (start === this.col || isSpace(current[this.col - 1])) return false;
    const word = current.slice(start, this.col).join("");
    const completed = step(word);
    if (completed === null) return false;
    this.lines[this.row] = current.slice(0, start).join("") + completed + current.slice(this.col).join("");
    this.col = start + codePoints(completed).length;
    return true;
  }
}
