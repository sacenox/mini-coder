import * as c from "yoctocolors";
import { renderLine } from "./markdown.ts";
import { G, write, writeln } from "./output.ts";
import type { Spinner } from "./spinner.ts";

export class StreamRenderContent {
	private inText = false;
	private inReasoning = false;
	private rawBuffer = "";
	private streamedChars = 0;
	private inFence = false;
	private reasoningBlankLineRun = 0;
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
		return this.inText || this.inReasoning;
	}

	appendTextDelta(delta: string): void {
		if (this.inReasoning) {
			this.flushOpenContent();
		}
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

	appendReasoningDelta(delta: string, showReasoning: boolean): void {
		this.accumulatedReasoning += delta;
		if (!showReasoning) return;

		if (!this.inReasoning) {
			if (this.inText) {
				this.flushOpenContent();
			}
			this.spinner.stop();
			writeln(`${G.info} ${c.dim("reasoning")}`);
			this.inReasoning = true;
			this.inFence = false;
		}
		this.rawBuffer += delta;
		this.flushCompleteLines();
		this.streamPartialRemainder();
	}

	flushOpenContent(): void {
		if (!this.inText && !this.inReasoning) return;
		this.streamPartialRemainder();
		writeln();
		this.inText = false;
		this.inReasoning = false;
		this.inFence = false;
		this.reasoningBlankLineRun = 0;
		this.rawBuffer = "";
		this.streamedChars = 0;
	}

	private renderSingleLine(raw: string): string | null {
		const source = this.inReasoning ? raw.replace(/[ \t]+$/g, "") : raw;
		if (this.inReasoning && source.trim() === "") {
			this.reasoningBlankLineRun += 1;
			if (this.reasoningBlankLineRun > 1) return null;
		} else if (this.inReasoning) {
			this.reasoningBlankLineRun = 0;
		}

		if (this.inReasoning) {
			return `  ${c.dim(source)}`;
		}
		const rendered = renderLine(source, this.inFence);
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
				if (rendered !== null) writeln(rendered);
				else writeln();
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
		if (this.inReasoning) {
			const prefix = this.streamedChars === 0 ? "  " : "";
			write(`${prefix}${c.dim(text)}`);
			return;
		}
		write(text);
	}
}
