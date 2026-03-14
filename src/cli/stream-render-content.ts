import { renderLine } from "./markdown.ts";
import { G, write, writeln } from "./output.ts";
import type { Spinner } from "./spinner.ts";

export class StreamRenderContent {
	private inText = false;
	private rawBuffer = "";
	private streamedChars = 0;
	private inFence = false;
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

	appendTextDelta(delta: string): void {
		if (!this.inText) {
			this.spinner.stop();
			write(`${G.reply} `);
			this.inText = true;
		}
		this.rawBuffer += delta;
		this.accumulatedText += delta;
		this.flushCompleteLines();
		this.streamPartialRemainder();
	}

	appendReasoningDelta(delta: string): void {
		this.accumulatedReasoning += delta;
	}

	flushOpenContent(): void {
		if (!this.inText) return;
		this.streamPartialRemainder();
		writeln();
		this.inText = false;
		this.inFence = false;
		this.rawBuffer = "";
		this.streamedChars = 0;
	}

	private renderSingleLine(raw: string): string {
		const rendered = renderLine(raw, this.inFence);
		this.inFence = rendered.inFence;
		return rendered.output;
	}

	private flushCompleteLines(): void {
		let boundary = this.rawBuffer.indexOf("\n");
		if (boundary === -1) return;
		this.spinner.stop();

		while (boundary !== -1) {
			const raw = this.rawBuffer.slice(0, boundary);
			const rendered = this.renderSingleLine(raw);
			const streamedForLine = Math.min(this.streamedChars, raw.length);

			if (streamedForLine > 0) {
				if (streamedForLine < raw.length) {
					this.writePartial(raw.slice(streamedForLine));
				}
				writeln();
			} else {
				writeln(rendered);
			}

			this.rawBuffer = this.rawBuffer.slice(boundary + 1);
			this.streamedChars = Math.max(0, this.streamedChars - raw.length);
			boundary = this.rawBuffer.indexOf("\n");
		}
	}

	private streamPartialRemainder(): void {
		if (this.rawBuffer.length <= this.streamedChars) return;
		this.spinner.stop();
		this.writePartial(this.rawBuffer.slice(this.streamedChars));
		this.streamedChars = this.rawBuffer.length;
	}

	private writePartial(text: string): void {
		if (!text) return;
		write(text);
	}
}
