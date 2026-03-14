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
 * Simulate terminal rendering for key cursor-control sequences used by the
 * stream renderer: `\r`, `\n`, `\x1b[2K` (erase line), and `\x1b[1A` (cursor up).
 */
function simulateTerminal(raw: string): string {
	const esc = String.fromCharCode(0x1b);
	// Strip ANSI SGR color/style codes first so we can compare plain text.
	const noColor = raw.replace(new RegExp(`${esc}\\[[0-9;]*m`, "g"), "");
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

function hasAnsi(s: string, code: string): boolean {
	return s.includes(`${String.fromCharCode(0x1b)}${code}`);
}

async function withTerminalColumns(
	cols: number,
	fn: () => Promise<void>,
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

function countOccurrences(haystack: string, needle: string): number {
	return haystack.split(needle).length - 1;
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

	test("clears wrapped streamed partials before rendering final line", async () => {
		captureStdout();
		await withTerminalColumns(20, async () => {
			await renderTurn(
				eventsFrom([
					{ type: "text-delta", delta: "this is a long streamed partial" },
					{ type: "text-delta", delta: " line\n" },
					done(),
				]),
				new Spinner(),
			);
		});

		expect(stdout.includes("\x1b[1A\r\x1b[2K")).toBe(true);
		expect(simulateTerminal(stdout)).toContain(
			"◆ this is a long streamed partial line\n",
		);
		expect(
			countOccurrences(
				simulateTerminal(stdout),
				"this is a long streamed partial line",
			),
		).toBe(1);
	});

	test("counts initial reply prefix when clearing near wrap boundary", async () => {
		captureStdout();
		await withTerminalColumns(20, async () => {
			await renderTurn(
				eventsFrom([
					{ type: "text-delta", delta: "1234567890123456789" },
					{ type: "text-delta", delta: "\n" },
					done(),
				]),
				new Spinner(),
			);
		});

		expect(stdout.includes("\r\x1b[2K\x1b[1A\r\x1b[2K")).toBe(true);
		expect(countOccurrences(stdout, "\x1b[1A\r\x1b[2K")).toBe(1);
		expect(simulateTerminal(stdout)).toContain("◆ 1234567890123456789\n");
	});

	test("does not over-clear wrapped rows for emoji grapheme clusters", async () => {
		captureStdout();
		await withTerminalColumns(8, async () => {
			await renderTurn(
				eventsFrom([
					{ type: "text-delta", delta: "👩🏽‍💻abc" },
					{ type: "text-delta", delta: "\n" },
					done(),
				]),
				new Spinner(),
			);
		});

		expect(countOccurrences(stdout, "\x1b[1A\r\x1b[2K")).toBe(0);
		expect(simulateTerminal(stdout)).toContain("◆ 👩🏽‍💻abc\n");
	});

	test("clears extra wrapped row for wide CJK characters", async () => {
		captureStdout();
		await withTerminalColumns(10, async () => {
			await renderTurn(
				eventsFrom([
					{ type: "text-delta", delta: "你好你好a" },
					{ type: "text-delta", delta: "\n" },
					done(),
				]),
				new Spinner(),
			);
		});

		expect(countOccurrences(stdout, "\x1b[1A\r\x1b[2K")).toBe(1);
		expect(simulateTerminal(stdout)).toContain("◆ 你好你好a\n");
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
		expect(simulateTerminal(stdout)).toBe("· reasoning\n  thinking\n");
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
			"· context pruned  balanced  –30 messages  –14.6 KB",
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
		expect(plain).toContain("· skill  deploy  ·  local  ·  Deploy app");
	});

	test("deduplicates repeated tool-call-start events for the same toolCallId", async () => {
		captureStdout();

		await renderTurn(
			eventsFrom([
				{
					type: "tool-call-start",
					toolName: "read",
					args: { path: "a.ts" },
					toolCallId: "tool-dup",
				},
				{
					type: "tool-call-start",
					toolName: "read",
					args: { path: "a.ts" },
					toolCallId: "tool-dup",
				},
				{
					type: "tool-result",
					toolName: "read",
					toolCallId: "tool-dup",
					isError: false,
					result: "ok",
				},
				done(),
			]),
			new Spinner(),
		);

		const plain = strip(stdout);
		expect(countOccurrences(plain, "← read")).toBe(1);
	});
});
