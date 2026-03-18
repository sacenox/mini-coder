import { stripAnsi } from "../internal/ansi.ts";
import type { CoreMessage } from "../llm-api/turn.ts";
import type { TurnEvent } from "../llm-api/types.ts";
import { terminal } from "./terminal-io.ts";

/** Temporarily set process.stdout.columns for terminal tests. */
export async function withTerminalColumns(
	cols: number,
	fn: () => Promise<void> | void,
): Promise<void> {
	const out = process.stdout as NodeJS.WriteStream & { columns?: number };
	const previous = Object.getOwnPropertyDescriptor(out, "columns");
	Object.defineProperty(out, "columns", {
		value: cols,
		configurable: true,
		writable: true,
	});
	try {
		await fn();
	} finally {
		if (previous) {
			Object.defineProperty(out, "columns", previous);
		} else {
			Object.defineProperty(out, "columns", {
				value: undefined,
				configurable: true,
				writable: true,
			});
		}
	}
}

let _capturedStdout = "";

const _originalDoStdoutWrite = terminal.doStdoutWrite.bind(terminal);

export function captureStdout(): void {
	_capturedStdout = "";
	terminal.doStdoutWrite = (text: string) => {
		_capturedStdout += text;
	};
}

export function getCapturedStdout(): string {
	return _capturedStdout;
}

export function restoreStdout(): void {
	_capturedStdout = "";
	terminal.doStdoutWrite = _originalDoStdoutWrite;
}

export { stripAnsi };

/**
 * Simulate terminal rendering for cursor-control sequences:
 * `\r`, `\n`, `\x1b[2K` (erase line), `\x1b[1A` (cursor up).
 * Strips ANSI SGR codes so the result is plain text.
 */
export function simulateTerminal(raw: string): string {
	const esc = "\x1b";
	const noColor = stripAnsi(raw);
	const lines: string[] = [""];
	let row = 0;
	let col = 0;
	let i = 0;

	const ensureRow = (idx: number): void => {
		while (lines.length <= idx) lines.push("");
	};

	while (i < noColor.length) {
		const ch = noColor[i];
		if (ch === "\n") {
			row++;
			ensureRow(row);
			col = 0;
			i++;
			continue;
		}
		if (ch === "\r") {
			col = 0;
			i++;
			continue;
		}
		if (ch === esc && noColor[i + 1] === "[") {
			if (noColor[i + 2] === "2" && noColor[i + 3] === "K") {
				lines[row] = "";
				col = 0;
				i += 4;
				continue;
			}
			if (noColor[i + 2] === "1" && noColor[i + 3] === "A") {
				row = Math.max(0, row - 1);
				col = Math.min(col, lines[row]?.length ?? 0);
				i += 4;
				continue;
			}
		}

		ensureRow(row);
		const line = lines[row] ?? "";
		if (col >= line.length) {
			lines[row] = line + ch;
		} else {
			lines[row] = `${line.slice(0, col)}${ch}${line.slice(col + 1)}`;
		}
		col++;
		i++;
	}

	return lines.join("\n");
}

/** Convert an array of TurnEvents into an AsyncIterable for renderTurn. */
export function eventsFrom(events: TurnEvent[]): AsyncIterable<TurnEvent> {
	return (async function* () {
		for (const event of events) {
			yield event;
		}
	})();
}

/** Create a turn-complete event with sensible defaults. */
export function turnDone(messages: CoreMessage[] = []): TurnEvent {
	return {
		type: "turn-complete",
		inputTokens: 1,
		outputTokens: 2,
		contextTokens: 3,
		messages,
	};
}

/** Shorthand for a shell result object. */
export function shellResult(opts: {
	stdout?: string;
	stderr?: string;
	exitCode?: number;
	success?: boolean;
}) {
	return {
		stdout: opts.stdout ?? "",
		stderr: opts.stderr ?? "",
		exitCode: opts.exitCode ?? 0,
		success: opts.success ?? true,
		timedOut: false,
	};
}
