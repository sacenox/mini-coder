import { afterEach, describe, expect, test } from "bun:test";
import type { CoreMessage } from "../llm-api/turn.ts";
import type { TurnEvent } from "../llm-api/types.ts";
import { Spinner } from "./spinner.ts";
import { renderTurn } from "./stream-render.ts";
import {
	captureStdout,
	getCapturedStdout,
	restoreStdout,
	simulateTerminal,
	stripAnsi,
} from "./test-helpers.ts";

afterEach(() => {
	restoreStdout();
});

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

function hasAnsi(s: string, code: string): boolean {
	return s.includes(`${String.fromCharCode(0x1b)}${code}`);
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

		expect(simulateTerminal(getCapturedStdout())).toBe(
			"◆ first line\nsecond line\n",
		);
		expect(result).toEqual({
			inputTokens: 1,
			outputTokens: 2,
			contextTokens: 3,
			newMessages: [],
			reasoningText: "",
		});
	});

	test("keeps plain streamed partial without clear/rewrite on turn end", async () => {
		captureStdout();

		await renderTurn(
			eventsFrom([{ type: "text-delta", delta: "plain text" }, done()]),
			new Spinner(),
		);

		expect(getCapturedStdout().includes("\r\x1b[2K")).toBe(false);
		expect(simulateTerminal(getCapturedStdout())).toBe("◆ plain text\n");
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
		expect(simulateTerminal(getCapturedStdout())).toBe("◆ hello\nworld\n");
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

		// Streaming now prioritizes immediate output stability over end-of-line markdown
		// rewrite, so raw markdown markers are preserved in partial lines.
		expect(simulateTerminal(getCapturedStdout())).toBe("◆ **bold** 👩🏽‍💻\n");
	});

	test("leaves fenced markdown plain across streamed lines", async () => {
		captureStdout();

		await renderTurn(
			eventsFrom([
				{ type: "text-delta", delta: "```ts\nconst emoji = '👩🏽‍💻';\n" },
				{ type: "text-delta", delta: "```\n" },
				done(),
			]),
			new Spinner(),
		);

		expect(stripAnsi(getCapturedStdout())).toBe(
			"◆ ```ts\nconst emoji = '👩🏽‍💻';\n```\n\n",
		);
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

		expect(simulateTerminal(getCapturedStdout())).toBe("◆ final\n");
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

	test("streams reasoning in a structured block and accumulates it", async () => {
		captureStdout();

		const result = await renderTurn(
			eventsFrom([{ type: "reasoning-delta", delta: "thinking" }, done()]),
			new Spinner(),
		);

		expect(simulateTerminal(getCapturedStdout())).toBe(
			"· reasoning\n  thinking\n",
		);
		expect(hasAnsi(getCapturedStdout(), "[2m")).toBe(true);
		expect(hasAnsi(getCapturedStdout(), "[3m")).toBe(true);
		expect(result.reasoningText).toBe("thinking");
	});

	test("splits adjacent reasoning markdown blocks across chunk boundaries", async () => {
		captureStdout();

		const result = await renderTurn(
			eventsFrom([
				{ type: "reasoning-delta", delta: "**Planning**" },
				{ type: "reasoning-delta", delta: "**Confirming**" },
				done(),
			]),
			new Spinner(),
		);

		expect(simulateTerminal(getCapturedStdout())).toBe(
			"· reasoning\n  **Planning**\n  **Confirming**\n",
		);
		expect(result.reasoningText).toBe("**Planning**\n**Confirming**");
	});

	test("renders reasoning before assistant text to preserve chronology", async () => {
		captureStdout();

		await renderTurn(
			eventsFrom([
				{ type: "reasoning-delta", delta: "step" },
				{ type: "text-delta", delta: "answer" },
				done(),
			]),
			new Spinner(),
		);

		expect(simulateTerminal(getCapturedStdout())).toBe(
			"· reasoning\n  step\n\n◆ answer\n",
		);
	});

	test("starts a new reasoning block after tool activity", async () => {
		captureStdout();

		await renderTurn(
			eventsFrom([
				{ type: "reasoning-delta", delta: "plan" },
				{
					type: "tool-call-start",
					toolName: "shell",
					toolCallId: "tool-1",
					args: { command: "echo hi" },
				},
				{
					type: "tool-result",
					toolName: "shell",
					toolCallId: "tool-1",
					isError: false,
					result: {
						stdout: "hi",
						stderr: "",
						exitCode: 0,
						success: true,
						timedOut: false,
					},
				},
				{ type: "reasoning-delta", delta: "done" },
				done(),
			]),
			new Spinner(),
		);

		const plain = stripAnsi(getCapturedStdout());
		expect(countOccurrences(plain, "· reasoning")).toBe(2);
		expect(plain).toContain("plan");
		expect(plain).toContain("$ echo hi");
		expect(plain).toContain("done");
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

		expect(stripAnsi(getCapturedStdout())).toBe("◆ line 1\nline 2\n\n");
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

		expect(stripAnsi(getCapturedStdout())).toContain(
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

		const plain = stripAnsi(getCapturedStdout());
		expect(plain).toContain("· skill  deploy  ·  local  ·  Deploy app");
	});

	test("non-TTY stdout: writes raw text without escape sequences", async () => {
		const originalIsTTY = process.stdout.isTTY;
		try {
			// biome-ignore lint/suspicious/noExplicitAny: test-only TTY override
			(process.stdout as any).isTTY = false;
			captureStdout();

			await renderTurn(
				eventsFrom([
					{ type: "text-delta", delta: "hello " },
					{ type: "text-delta", delta: "world" },
					done(),
				]),
				new Spinner(),
			);
		} finally {
			// biome-ignore lint/suspicious/noExplicitAny: test-only TTY override
			(process.stdout as any).isTTY = originalIsTTY;
		}

		// No erase-line or carriage-return sequences in output
		expect(getCapturedStdout().includes("\x1b[2K")).toBe(false);
		expect(getCapturedStdout().includes("\r")).toBe(false);
		expect(stripAnsi(getCapturedStdout())).toBe("◆ hello world\n");
	});

	test("strips leading whitespace from the first text delta", async () => {
		captureStdout();

		await renderTurn(
			eventsFrom([{ type: "text-delta", delta: "\n\n  hello" }, done()]),
			new Spinner(),
		);

		expect(simulateTerminal(getCapturedStdout())).toBe("◆ hello\n");
	});

	test("skips whitespace-only deltas before actual text content", async () => {
		captureStdout();

		await renderTurn(
			eventsFrom([
				{ type: "text-delta", delta: "\n\n" },
				{ type: "text-delta", delta: "  " },
				{ type: "text-delta", delta: "\nhello" },
				done(),
			]),
			new Spinner(),
		);

		expect(simulateTerminal(getCapturedStdout())).toBe("◆ hello\n");
	});

	test("deduplicates repeated tool-call-start events for the same toolCallId", async () => {
		captureStdout();

		await renderTurn(
			eventsFrom([
				{
					type: "tool-call-start",
					toolName: "shell",
					args: { command: "printf ok" },
					toolCallId: "tool-dup",
				},
				{
					type: "tool-call-start",
					toolName: "shell",
					args: { command: "printf ok" },
					toolCallId: "tool-dup",
				},
				{
					type: "tool-result",
					toolName: "shell",
					toolCallId: "tool-dup",
					isError: false,
					result: {
						stdout: "ok",
						stderr: "",
						exitCode: 0,
						success: true,
						timedOut: false,
					},
				},
				done(),
			]),
			new Spinner(),
		);

		const plain = stripAnsi(getCapturedStdout());
		expect(countOccurrences(plain, "$ printf ok")).toBe(1);
	});
});
