import { G, write, writeln } from "./output.ts";
import type { Spinner } from "./spinner.ts";

export class StreamRenderContent {
	private inText = false;
	private accumulatedText = "";
	private accumulatedReasoning = "";

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
		}
		this.accumulatedText += text;
		this.spinner.stop();
		write(text);
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
		writeln();
		this.inText = false;
	}
}
