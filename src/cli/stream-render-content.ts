import {
	createHighlighter,
	type Highlighter,
} from "yoctomarkdown/src/index.ts";
import { G, write, writeln } from "./output.ts";
import type { Spinner } from "./spinner.ts";

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
			this.highlighter = createHighlighter();
		}
		this.accumulatedText += text;
		this.spinner.stop();
		if (this.highlighter) {
			const colored = this.highlighter.write(text);
			if (colored) write(colored);
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
			const finalColored = this.highlighter.end();
			if (finalColored) write(finalColored);
		}
		writeln();
		this.inText = false;
	}
}
