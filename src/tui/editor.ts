import { displayWidth, expandTabs, wrapLine, type Key } from "./term.ts";

function codePoints(line: string): string[] {
  return Array.from(line);
}

export interface EditorRender {
  rows: string[];
  cursorRow: number;
  cursorCol: number;
}

export class Editor {
  private lines: string[] = [""];
  private row = 0;
  private col = 0;

  text(): string {
    return this.lines.join("\n");
  }

  clear(): void {
    this.lines = [""];
    this.row = 0;
    this.col = 0;
  }

  handle(key: Key): "submit" | "changed" | "none" {
    switch (key.type) {
      case "text":
        this.insert(key.text);
        return "changed";
      case "newline":
        this.insert("\n");
        return "changed";
      case "tab":
        this.insert("\t");
        return "changed";
      case "backspace":
        this.backspace();
        return "changed";
      case "delete":
        this.deleteForward();
        return "changed";
      case "left":
        this.left();
        return "changed";
      case "right":
        this.right();
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
      case "wordBack":
        this.wordBack();
        return "changed";
      case "enter":
        return "submit";
      default:
        return "none";
    }
  }

  render(width: number): EditorRender {
    const rows: string[] = [];
    let cursorRow = 0;
    let cursorCol = 0;
    for (let line = 0; line < this.lines.length; line++) {
      const expanded = expandTabs(this.lines[line]);
      const chunks = wrapLine(expanded, width);
      if (line === this.row) {
        const prefix = codePoints(expanded)
          .slice(0, this.col)
          .join("");
        const prefixWidth = displayWidth(prefix);
        let rowInLine = Math.floor(prefixWidth / width);
        if (rowInLine >= chunks.length) {
          rowInLine = chunks.length - 1;
          cursorCol = displayWidth(chunks[rowInLine]);
        } else {
          cursorCol = prefixWidth - rowInLine * width;
        }
        cursorRow = rows.length + rowInLine;
      }
      rows.push(...chunks);
    }
    return { rows, cursorRow, cursorCol };
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

  private up(): void {
    if (this.row > 0) {
      this.row--;
      this.col = Math.min(this.col, codePoints(this.lines[this.row]).length);
    }
  }

  private down(): void {
    if (this.row < this.lines.length - 1) {
      this.row++;
      this.col = Math.min(this.col, codePoints(this.lines[this.row]).length);
    }
  }

  private wordBack(): void {
    const current = codePoints(this.lines[this.row]);
    const start = this.col;
    while (this.col > 0 && current[this.col - 1] === " ") this.col--;
    while (this.col > 0 && current[this.col - 1] !== " ") this.col--;
    this.lines[this.row] = current.slice(0, this.col).join("") + current.slice(start).join("");
  }
}
