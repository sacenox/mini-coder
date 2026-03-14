import * as c from "yoctocolors";
import { terminal } from "./terminal-io.ts";

const LIVE_OUTPUT_PREFIX = `    ${c.dim("│")} `;

function write(text: string): void {
	terminal.stdoutWrite(text);
}

function writeln(text = ""): void {
	terminal.stdoutWrite(`${text}\n`);
}

export class LiveOutputBlock {
	private pending = "";
	private lineOpen = false;

	append(chunk: string): void {
		if (!chunk) return;
		this.pending += chunk.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
		this.flushCompleteLines();
	}

	finish(): void {
		if (this.pending.length > 0) {
			this.openLine();
			write(this.pending);
			this.pending = "";
		}
		if (this.lineOpen) {
			writeln();
			this.lineOpen = false;
		}
	}

	private flushCompleteLines(): void {
		let boundary = this.pending.indexOf("\n");
		while (boundary !== -1) {
			const line = this.pending.slice(0, boundary);
			this.openLine();
			write(line);
			writeln();
			this.lineOpen = false;
			this.pending = this.pending.slice(boundary + 1);
			boundary = this.pending.indexOf("\n");
		}
	}

	private openLine(): void {
		if (this.lineOpen) return;
		write(LIVE_OUTPUT_PREFIX);
		this.lineOpen = true;
	}
}
