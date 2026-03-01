import * as c from "yoctocolors";

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export class Spinner {
	private frame = 0;
	private timer: Timer | null = null;
	private label = "";

	start(label = ""): void {
		this.label = label;
		if (this.timer) return;
		process.stderr.write("\x1B[?25l");
		this._tick();
		this.timer = setInterval(() => this._tick(), 80);
	}

	stop(): void {
		if (!this.timer) return;
		clearInterval(this.timer);
		this.timer = null;
		process.stderr.write("\r\x1B[2K\x1B[?25h");
	}

	update(label: string): void {
		this.label = label;
	}

	private _tick(): void {
		const f = FRAMES[this.frame++ % FRAMES.length] ?? "⠋";
		const label = this.label ? c.dim(` ${this.label}`) : "";
		process.stderr.write(`\r${c.dim(f)}${label}`);
	}
}
