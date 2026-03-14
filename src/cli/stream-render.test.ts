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

/**
 * Simulate terminal rendering: apply carriage-return + erase-line sequences
 * (`\r\x1b[2K`) so tests reflect what the user actually sees on screen.
 * This mirrors the partial-line overwrite strategy used by the stream renderer.
 */
function simulateTerminal(raw: string): string {
	const esc = String.fromCharCode(0x1b);
	// Strip all ANSI SGR color/style codes first so we can compare plain text.
	const noColor = raw.replace(new RegExp(`${esc}\\[[0-9;]*m`, "g"), "");
	// Process line-by-line, handling \r (return to line start) and \x1b[2K (erase line).
	const lines: string[] = [];
	let current = "";
	let i = 0;
	while (i < noColor.length) {
		const ch = noColor[i];
		if (ch === "\n") {
			lines.push(current);
			current = "";
			i++;
		} else if (ch === "\r") {
			// Carriage return: check for \x1b[2K (erase-line) immediately after.
			if (
				noColor[i + 1] === esc &&
				noColor[i + 2] === "[" &&
				noColor[i + 3] === "2" &&
				noColor[i + 4] === "K"
			) {
				// Clear the current line and skip the escape sequence.
				current = "";
				i += 5;
			} else {
				// Plain \r: go to start of line but keep existing content to be
				// overwritten character by character. Just reset position marker.
				current = "";
				i++;
			}
		} else {
			current += ch;
			i++;
		}
	}
	lines.push(current);
	return lines.join("\n");
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

		expect(simulateTerminal(stdout)).toBe("◆ first line\nsecond line\n");
		expect(result).toEqual({
			inputTokens: 1,
			outputTokens: 2,
			contextTokens: 3,
			newMessages: [],
			reasoningText: "",
		});
	});

	test("preserves reply glyph on partial-line overwrite after a complete line in same delta", async () => {
		captureStdout();

		await renderTurn(
			eventsFrom([{ type: "text-delta", delta: "hello\nworld" }, done()]),
			new Spinner(),
		);

		// "hello\n" is flushed as a complete line. "world" is streamed as a
		// partial then overwritten on turn-end. The ◆ prefix appears only on
		// the first line; continuation lines have no prefix.
		expect(simulateTerminal(stdout)).toBe("◆ hello\nworld\n");
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

		// The partial raw text is streamed immediately and then overwritten on
		// turn-end with the fully styled line (bold ANSI codes applied).
		expect(simulateTerminal(stdout)).toBe("◆ bold 👩🏽‍💻\n");
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

		expect(simulateTerminal(stdout)).toBe("◆ final\n");
		expect(result.reasoningText).toBe("step 1\nstep 2");
	});

	test("normalizes reasoning whitespace safely", async () => {
		captureStdout();

		const result = await renderTurn(
			eventsFrom([
				{
					type: "reasoning-delta",
					delta: "\r\n\r\n  hello   \r\n\r\n\r\nworld\t\t\r\n\r\n",
				},
				done(),
			]),
			new Spinner(),
			{ showReasoning: false },
		);

		expect(result.reasoningText).toBe("  hello\n\nworld");
	});

	test("renders reasoning in a structured block and accumulates it", async () => {
		captureStdout();

		const result = await renderTurn(
			eventsFrom([{ type: "reasoning-delta", delta: "thinking" }, done()]),
			new Spinner(),
		);

		// The partial reasoning text is streamed raw and then overwritten on
		// turn-end with the properly styled (dimmed) version.
		expect(simulateTerminal(stdout)).toBe("· reasoning\n│ thinking\n");
		expect(hasAnsi(stdout, "[2m")).toBe(true);
		expect(result.reasoningText).toBe("thinking");
	});

	test("stops spinner defensively before each rendered line", async () => {
		captureStdout();
		const spinner = new Spinner();
		let stopCalls = 0;
		spinner.stop = () => {
			stopCalls++;
		};

		await renderTurn(
			eventsFrom([
				{ type: "text-delta", delta: "line 1\n" },
				{ type: "text-delta", delta: "line 2\n" },
				done(),
			]),
			spinner,
		);

		expect(strip(stdout)).toBe("◆ line 1\nline 2\n\n");
		expect(stopCalls).toBeGreaterThanOrEqual(2);
	});

	test("renders a structured context-pruned line", async () => {
		captureStdout();

		await renderTurn(
			eventsFrom([
				{
					type: "context-pruned",
					mode: "balanced",
					beforeMessageCount: 120,
					afterMessageCount: 90,
					removedMessageCount: 30,
					beforeTotalBytes: 40000,
					afterTotalBytes: 25000,
					removedBytes: 15000,
				},
				done(),
			]),
			new Spinner(),
		);

		expect(strip(stdout)).toContain(
			"context-pruned mode=balanced removed_messages=30 removed_bytes=15000 messages_before=120 messages_after=90",
		);
	});

	test("renders structured user-visible output when a skill is auto-loaded", async () => {
		captureStdout();

		await renderTurn(
			eventsFrom([
				{
					type: "tool-call-start",
					toolName: "readSkill",
					args: { name: "deploy" },
					toolCallId: "tool-1",
				},
				{
					type: "tool-result",
					toolName: "readSkill",
					toolCallId: "tool-1",
					isError: false,
					result: {
						skill: {
							name: "deploy",
							description: "Deploy app",
							source: "local",
						},
					},
				},
				done(),
			]),
			new Spinner(),
		);

		const plain = strip(stdout);
		expect(plain).toContain(
			'skill-auto-loaded name=deploy source=local description="Deploy app"',
		);
	});
});
