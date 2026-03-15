import * as c from "yoctocolors";
import { terminal } from "./terminal-io.ts";

export const SPINNER_FRAMES = ["⣾", "⣽", "⣻", "⢿", "⡿", "⣟", "⣯", "⣷"];

export class Spinner {
	private frame = 0;
	private timer: Timer | null = null;
	private label = "";

	start(label = ""): void {
		if (!terminal.isStderrTTY) return;
		this.label = label;
		if (this.timer) return;
		terminal.stderrWrite("\x1B[?25l");
		this._tick();
		this.timer = setInterval(() => this._tick(), 80);
		terminal.setBeforeWriteCallback(() => {
			this.clear();
		});
	}

	private clear(): void {
		terminal.stderrWrite("\r\x1B[2K");
	}

	stop(): void {
		if (!this.timer) return;
		clearInterval(this.timer);
		this.timer = null;
		terminal.setBeforeWriteCallback(null);
		terminal.stderrWrite("\r\x1B[2K\x1B[?25h");
	}

	update(label: string): void {
		this.label = label;
	}

	private _tick(): void {
		const f = SPINNER_FRAMES[this.frame++ % SPINNER_FRAMES.length] ?? "⣾";
		const label = this.label ? c.dim(` ${this.label}`) : "";
		terminal.stderrWrite(`\r${c.dim(f)}${label}`);
	}
}
