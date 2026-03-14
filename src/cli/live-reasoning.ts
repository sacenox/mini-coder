import * as c from "yoctocolors";
import { G, writeln } from "./output.ts";

export class LiveReasoningBlock {
	private blockOpen = false;
	private pending = "";

	append(delta: string): void {
		if (!delta) return;
		this.openBlock();
		this.pending += delta;
		this.flushCompleteLines();
	}

	finish(): void {
		if (!this.blockOpen) return;
		if (this.pending.length > 0) {
			this.writeLine(this.pending);
			this.pending = "";
		}
		this.blockOpen = false;
	}

	private openBlock(): void {
		if (this.blockOpen) return;
		writeln(`${G.info} ${c.dim("reasoning")}`);
		this.blockOpen = true;
	}

	private flushCompleteLines(): void {
		let boundary = this.pending.indexOf("\n");
		while (boundary !== -1) {
			this.writeLine(this.pending.slice(0, boundary));
			this.pending = this.pending.slice(boundary + 1);
			boundary = this.pending.indexOf("\n");
		}
	}

	private writeLine(line: string): void {
		writeln(`  ${c.dim(line)}`);
	}
}
