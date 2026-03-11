import { afterEach, describe, expect, test } from "bun:test";
import type { CoreMessage } from "../llm-api/turn.ts";
import type { TurnEvent } from "../llm-api/types.ts";
import { Spinner } from "./spinner.ts";
import { renderTurn } from "./stream-render.ts";
import { terminal } from "./terminal-io.ts";

let stdout = "";
const originalStdoutWrite = terminal.stdoutWrite.bind(terminal);

afterEach(() => {
	stdout = "";
	terminal.stdoutWrite = originalStdoutWrite;
});

function captureStdout(): void {
	terminal.stdoutWrite = (text: string) => {
		stdout += text;
	};
}

function eventsFrom(events: TurnEvent[]): AsyncIterable<TurnEvent> {
	return (async function* () {
		for (const event of events) {
			yield event;
		}
	})();
}

function done(messages: CoreMessage[] = []): TurnEvent {
	return {
		type: "turn-complete",
		inputTokens: 1,
		outputTokens: 2,
		contextTokens: 3,
		messages,
	};
}

function strip(s: string): string {
	const esc = String.fromCharCode(0x1b);
	return s.replace(new RegExp(`${esc}\\[[0-9;]*m`, "g"), "");
}

function hasAnsi(s: string, code: string): boolean {
	return s.includes(`${String.fromCharCode(0x1b)}${code}`);
}

describe("renderTurn", () => {
	test("renders complete lines immediately and flushes the trailing partial line", async () => {
		captureStdout();

		const result = await renderTurn(
			eventsFrom([
				{ type: "text-delta", delta: "first line\nsecond" },
				{ type: "text-delta", delta: " line" },
				done(),
			]),
			new Spinner(),
		);

		expect(strip(stdout)).toBe("◆ first line\nsecond line\n");
		expect(result).toEqual({
			inputTokens: 1,
			outputTokens: 2,
			contextTokens: 3,
			newMessages: [],
			reasoningText: "",
		});
	});

	test("renders buffered markdown correctly and preserves emoji across deltas", async () => {
		captureStdout();

		await renderTurn(
			eventsFrom([
				{ type: "text-delta", delta: "**bo" },
				{ type: "text-delta", delta: "ld** 👩🏽‍💻" },
				done(),
			]),
			new Spinner(),
		);

		expect(strip(stdout)).toBe("◆ bold 👩🏽‍💻\n");
		expect(hasAnsi(stdout, "[1m")).toBe(true);
	});

	test("preserves fenced-code state across streamed lines", async () => {
		captureStdout();

		await renderTurn(
			eventsFrom([
				{ type: "text-delta", delta: "```ts\nconst emoji = '👩🏽‍💻';\n" },
				{ type: "text-delta", delta: "```\n" },
				done(),
			]),
			new Spinner(),
		);

		const lines = stdout.split("\n");
		expect(strip(stdout)).toBe("◆ ```ts\nconst emoji = '👩🏽‍💻';\n```\n\n");
		expect(hasAnsi(lines[0] ?? "", "[2m")).toBe(true);
		expect(hasAnsi(lines[1] ?? "", "[33m")).toBe(true);
		expect(hasAnsi(lines[2] ?? "", "[2m")).toBe(true);
	});
	test("can hide reasoning output while still accumulating reasoning text", async () => {
		captureStdout();

		const result = await renderTurn(
			eventsFrom([
				{ type: "reasoning-delta", delta: "step 1\nstep 2" },
				{ type: "text-delta", delta: "final" },
				done(),
			]),
			new Spinner(),
			{ showReasoning: false },
		);

		expect(strip(stdout)).toBe("◆ final\n");
		expect(result.reasoningText).toBe("step 1\nstep 2");
	});

	test("renders reasoning output by default and accumulates it", async () => {
		captureStdout();

		const result = await renderTurn(
			eventsFrom([{ type: "reasoning-delta", delta: "thinking" }, done()]),
			new Spinner(),
		);

		expect(strip(stdout)).toBe("Thinking...\nthinking\n");
		expect(result.reasoningText).toBe("thinking");
	});
});
