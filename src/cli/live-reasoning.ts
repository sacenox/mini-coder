import * as c from "yoctocolors";
import { G, write, writeln } from "./output.ts";

function styleReasoningText(text: string): string {
  return c.italic(c.dim(text));
}

export class LiveReasoningBlock {
  private blockOpen = false;
  private lineOpen = false;

  append(delta: string): void {
    if (!delta) return;
    this.openBlock();
    const lines = delta.split("\n");
    for (const [index, line] of lines.entries()) {
      if (line) this.writeText(line);
      if (index < lines.length - 1) this.endLine();
    }
  }

  isOpen(): boolean {
    return this.blockOpen;
  }

  finish(): void {
    if (!this.blockOpen) return;
    if (this.lineOpen) writeln();
    this.blockOpen = false;
    this.lineOpen = false;
  }

  private openBlock(): void {
    if (this.blockOpen) return;
    writeln(`${G.info} ${c.dim("reasoning")}`);
    this.blockOpen = true;
  }

  private writeText(text: string): void {
    if (!this.lineOpen) {
      write("  ");
      this.lineOpen = true;
    }
    write(styleReasoningText(text));
  }

  private endLine(): void {
    if (!this.lineOpen) write("  ");
    writeln();
    this.lineOpen = false;
  }
}
