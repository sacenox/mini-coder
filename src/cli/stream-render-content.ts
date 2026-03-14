import * as c from "yoctocolors";
import { renderLine } from "./markdown.ts";
import { G, write, writeln } from "./output.ts";
import type { Spinner } from "./spinner.ts";
import {
	buildClearPartialPreview,
	createPartialPreviewTracker,
	resetPartialPreviewTracker,
	setStreamPreviewPrefix,
	streamPartialPreviewDelta,
} from "./stream-preview.ts";
import { terminal } from "./terminal-io.ts";

export class StreamRenderContent {
	private inText = false;
	private inReasoning = false;
	private rawBuffer = "";
	private styledPrefix = "";
	private partialPreview = createPartialPreviewTracker();
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
			setStreamPreviewPrefix(this.partialPreview, `${G.reply} `, true);
			this.styledPrefix = `${G.reply} `;
			this.inText = true;
		}
		this.rawBuffer += delta;
		this.accumulatedText += delta;

		this.flushCompleteLines();
		this.streamPartialLine();
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
			setStreamPreviewPrefix(this.partialPreview, "  ", false);
			this.styledPrefix = "";
		}
		this.rawBuffer += delta;
		this.flushCompleteLines();
		this.streamPartialLine();
	}

	flushOpenContent(): void {
		if (!this.inText && !this.inReasoning) return;

		if (this.rawBuffer) {
			this.spinner.stop();
			const raw = this.rawBuffer;
			const out = this.renderSingleLine(raw);
			this.rawBuffer = "";
			if (this.partialPreview.partialWritten > 0) {
				if (!this.canKeepStreamedPartial(raw, out)) {
					const clearSeq = buildClearPartialPreview(
						this.partialPreview,
						terminal.stdoutColumns,
					);
					if (out !== null) write(`${clearSeq}${this.styledPrefix}${out}`);
					else write(clearSeq);
				}
			} else if (out !== null) {
				write(out);
			}
		}
		writeln();
		this.inText = false;
		this.inReasoning = false;
		this.inFence = false;
		this.reasoningBlankLineRun = 0;
		this.styledPrefix = "";
		this.resetLineState();
	}

	private canKeepStreamedPartial(raw: string, out: string | null): boolean {
		return (
			this.inText &&
			out === raw &&
			this.partialPreview.partialWritten === raw.length
		);
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
			return `  ${c.dim(c.italic(source))}`;
		}
		const rendered = renderLine(source, this.inFence);
		this.inFence = rendered.inFence;
		return rendered.output;
	}

	private resetLineState(): void {
		resetPartialPreviewTracker(this.partialPreview);
	}

	private flushCompleteLines(): void {
		let start = 0;
		let boundary = this.rawBuffer.indexOf("\n", start);
		if (boundary === -1) return;

		this.spinner.stop();
		let batchOutput = "";
		let firstLine = true;

		while (boundary !== -1) {
			const raw = this.rawBuffer.slice(start, boundary);
			start = boundary + 1;
			boundary = this.rawBuffer.indexOf("\n", start);

			const out = this.renderSingleLine(raw);
			if (firstLine && this.partialPreview.partialWritten > 0) {
				if (this.canKeepStreamedPartial(raw, out)) {
					batchOutput += "\n";
				} else {
					const clearSeq = buildClearPartialPreview(
						this.partialPreview,
						terminal.stdoutColumns,
					);
					if (out !== null) {
						batchOutput += `${clearSeq}${this.styledPrefix}${out}\n`;
					} else {
						batchOutput += `${clearSeq}\n`;
					}
				}
			} else if (out !== null) {
				batchOutput += `${out}\n`;
			}
			firstLine = false;
		}

		this.rawBuffer = start > 0 ? this.rawBuffer.slice(start) : this.rawBuffer;
		this.styledPrefix = "";
		this.resetLineState();
		if (batchOutput) write(batchOutput);
	}

	private streamPartialLine(): void {
		const out = streamPartialPreviewDelta(this.partialPreview, this.rawBuffer);
		if (!out) return;
		this.spinner.stop();
		write(out);
	}
}
