import { visibleLength } from "./terminal-width.ts";

interface PartialPreviewTracker {
	partialWritten: number;
	partialVisibleChars: number;
	streamPrefix: string;
	streamPrefixWritten: boolean;
}

export function createPartialPreviewTracker(): PartialPreviewTracker {
	return {
		partialWritten: 0,
		partialVisibleChars: 0,
		streamPrefix: "",
		streamPrefixWritten: false,
	};
}

export function resetPartialPreviewTracker(
	tracker: PartialPreviewTracker,
): void {
	tracker.partialWritten = 0;
	tracker.partialVisibleChars = 0;
	tracker.streamPrefix = "";
	tracker.streamPrefixWritten = false;
}

export function setStreamPreviewPrefix(
	tracker: PartialPreviewTracker,
	prefix: string,
	written: boolean,
): void {
	tracker.streamPrefix = prefix;
	tracker.streamPrefixWritten = written;
	if (written && prefix) {
		tracker.partialVisibleChars += visibleLength(prefix);
	}
}

function estimateWrappedRows(
	visibleChars: number,
	terminalColumns: number,
): number {
	if (visibleChars <= 0) return 1;
	if (terminalColumns <= 0) return 1;
	return Math.max(1, Math.ceil(visibleChars / terminalColumns));
}

export function buildClearPartialPreview(
	tracker: PartialPreviewTracker,
	terminalColumns: number,
): string {
	if (tracker.partialWritten <= 0) return "";
	const rows = estimateWrappedRows(
		tracker.partialVisibleChars,
		terminalColumns,
	);
	let seq = "\r\x1b[2K";
	for (let i = 1; i < rows; i++) {
		seq += "\x1b[1A\r\x1b[2K";
	}
	return seq;
}

export function streamPartialPreviewDelta(
	tracker: PartialPreviewTracker,
	rawBuffer: string,
): string {
	if (rawBuffer.length <= tracker.partialWritten) return "";

	let out = "";
	if (!tracker.streamPrefixWritten && tracker.streamPrefix) {
		out += tracker.streamPrefix;
		tracker.streamPrefixWritten = true;
		tracker.partialVisibleChars += visibleLength(tracker.streamPrefix);
	}

	const delta = rawBuffer.slice(tracker.partialWritten);
	out += delta;
	tracker.partialVisibleChars += visibleLength(delta);
	tracker.partialWritten = rawBuffer.length;
	return out;
}
