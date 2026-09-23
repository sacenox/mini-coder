import { dim } from "./styles.ts";

/** One logical display line: unwrapped text plus the style its rows inherit. */
export interface BodyLine {
  text: string;
  style?: (text: string) => string;
}

/** The text after the last newline: what is still incomplete. */
function tail(text: string): string {
  return text.slice(text.lastIndexOf("\n") + 1);
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

/** Commits each complete line; the incomplete tail stays in flight. */
export class LineStream implements StreamRenderer {
  private rest = "";

  feed(delta: string): BodyLine[] {
    this.rest += delta;
    const lines = this.rest.split("\n");
    this.rest = lines.pop()!;
    return lines.map((text) => ({ text }));
  }

  pending(): BodyLine[] {
    return this.rest === "" ? [] : [{ text: this.rest }];
  }

  flush(): BodyLine[] {
    const lines = this.pending();
    this.reset();
    return lines;
  }

  reset(): void {
    this.rest = "";
  }
}

/** Keeps only the incomplete tail, dimmed; nothing is ever committed. */
export class TailStream implements StreamRenderer {
  private rest = "";

  feed(delta: string): BodyLine[] {
    this.rest = tail(this.rest + delta);
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
