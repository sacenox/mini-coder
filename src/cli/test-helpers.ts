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
