import { createHighlighter, type Highlighter } from "yoctomarkdown";
import { G, write, writeln } from "./output.ts";
import type { Spinner } from "./spinner.ts";
import { terminal } from "./terminal-io.ts";

export class StreamRenderContent {
	private inText = false;
	private accumulatedText = "";
	private accumulatedReasoning = "";
	private highlighter: Highlighter | undefined;

	constructor(private readonly spinner: Spinner) {}

	getText(): string {
		return this.accumulatedText;
	}

	getReasoning(): string {
		return this.accumulatedReasoning;
	}

	hasOpenContent(): boolean {
		return this.inText;
	}

	appendTextDelta(
		delta: string | undefined,
		renderedVisibleOutput: boolean,
	): void {
		const text = delta ?? "";
		if (!text) return;
		if (!this.inText) {
			this.spinner.stop();
			if (renderedVisibleOutput) writeln();
			write(`${G.reply} `);
			this.inText = true;
			if (terminal.isStdoutTTY) this.highlighter = createHighlighter();
		}
		const isFirstLine = !this.accumulatedText.includes("\n");
		this.accumulatedText += text;
		this.spinner.stop();
		if (this.highlighter) {
			let colored = this.highlighter.write(text);
			if (colored) {
				if (isFirstLine && colored.startsWith("\x1b[2K\r")) {
					colored = `\x1b[2K\r${G.reply} ${colored.slice(5)}`;
				}
				write(colored);
			}
		} else {
			write(text);
		}
	}

	appendReasoningDelta(delta: string | undefined): string {
		const text = delta ?? "";
		if (!text) return "";
		let appended = text;
		if (
			this.accumulatedReasoning.endsWith("**") &&
			text.startsWith("**") &&
			!this.accumulatedReasoning.endsWith("\n")
		) {
			appended = `\n${text}`;
		}
		this.accumulatedReasoning += appended;
		return appended;
	}

	flushOpenContent(): void {
		if (!this.inText) return;
		if (this.highlighter) {
			let finalColored = this.highlighter.end();
			if (finalColored) {
				const isFirstLine = !this.accumulatedText.includes("\n");
				if (isFirstLine && finalColored.startsWith("\x1b[2K\r")) {
					finalColored = `\x1b[2K\r${G.reply} ${finalColored.slice(5)}`;
				}
				write(finalColored);
			}
		}
		writeln();
		this.inText = false;
	}
}
