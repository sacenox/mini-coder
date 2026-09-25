import { highlightCode, highlightMarkdown } from "./highlight.ts";
import { dim } from "./styles.ts";

/** One logical display line: unwrapped text plus the style its rows inherit. */
export interface BodyLine {
  text: string;
  style?: (text: string) => string;
  /** Row background, painted across the row's trailing cells by the renderer. */
  bg?: string;
}

/**
 * A text stream projected onto display lines. `feed` and `flush` return the
 * lines that became final; `pending` returns what is still in flight.
 */
export interface StreamRenderer {
  feed(delta: string): BodyLine[];
  pending(): BodyLine[];
  flush(): BodyLine[];
  reset(): void;
}

/** A fence opening line, and the info string that names its language. */
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})\s*(\S*)/;
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})\s*$/;

/**
 * Commits each complete line, colored. A fenced code block is held until its
 * closing marker arrives, because neither the fence's language nor its body can
 * be known before then. A run of prose is held until its block ends, because
 * block context is what separates a setext heading from a paragraph and spans
 * may cross lines; a blank line, a fence or the end of the turn ends the block.
 * The live preview shows the held lines uncolored.
 */
export class MarkdownStream implements StreamRenderer {
  private rest = "";
  private fence: { marker: string; info: string; lines: string[] } | null = null;
  private prose: string[] = [];

  feed(delta: string): BodyLine[] {
    this.rest += delta;
    const lines = this.rest.split("\n");
    this.rest = lines.pop()!;
    return lines.flatMap((line) => this.commit(line));
  }

  pending(): BodyLine[] {
    const held = this.fence === null ? this.prose : this.fence.lines;
    const rest = this.rest === "" ? [] : [this.rest];
    return [...held, ...rest].map((text) => ({ text }));
  }

  flush(): BodyLine[] {
    const fence = this.fence;
    const lines = fence === null ? this.releaseProse(this.rest) : this.releaseFence(null);
    if (fence !== null && this.rest !== "") lines.push({ text: highlightMarkdown(this.rest) });
    this.reset();
    return lines;
  }

  reset(): void {
    this.rest = "";
    this.fence = null;
    this.prose = [];
  }

  private commit(line: string): BodyLine[] {
    const fence = this.fence;
    if (fence !== null) {
      const close = FENCE_CLOSE.exec(line);
      if (close === null || close[1][0] !== fence.marker[0] || close[1].length < fence.marker.length) {
        fence.lines.push(line);
        return [];
      }
      return this.releaseFence(line);
    }
    const open = FENCE_OPEN.exec(line);
    if (open !== null) {
      this.fence = { marker: open[1], info: open[2], lines: [line] };
      return this.releaseProse("");
    }
    if (line.trim() === "") return [...this.releaseProse(""), { text: line }];
    this.prose.push(line);
    return [];
  }

  /**
   * Emits the held prose as one text, so the grammar sees whole blocks, then
   * hands back the lines. `tail` is the still incomplete line closing the block.
   */
  private releaseProse(tail: string): BodyLine[] {
    const prose = this.prose;
    this.prose = [];
    if (tail !== "") prose.push(tail);
    if (prose.length === 0) return [];
    // A block is only a block once its last line ends, so the text needs a
    // terminating newline. It is not a line itself: the closing reset `paint`
    // leaves after it belongs to the last one.
    const lines = highlightMarkdown(`${prose.join("\n")}\n`).split("\n");
    const reset = lines.pop()!;
    lines[lines.length - 1] += reset;
    return lines.map((text) => ({ text }));
  }

  /** Emits a held block: the fence lines colored, the body by its language. */
  private releaseFence(closing: string | null): BodyLine[] {
    const fence = this.fence!;
    this.fence = null;
    const lines: BodyLine[] = [{ text: highlightMarkdown(fence.lines.shift()!) }];
    if (fence.lines.length > 0) {
      for (const line of highlightCode(fence.info, fence.lines.join("\n")).split("\n")) {
        lines.push({ text: line });
      }
    }
    if (closing !== null) lines.push({ text: highlightMarkdown(closing) });
    return lines;
  }
}

/** Keeps only the incomplete tail, dimmed; nothing is ever committed. */
export class TailStream implements StreamRenderer {
  private rest = "";

  feed(delta: string): BodyLine[] {
    const text = this.rest + delta;
    this.rest = text.slice(text.lastIndexOf("\n") + 1);
    return [];
  }

  pending(): BodyLine[] {
    return this.rest === "" ? [] : [{ text: this.rest, style: dim }];
  }

  flush(): BodyLine[] {
    this.reset();
    return [];
  }

  reset(): void {
    this.rest = "";
  }
}
