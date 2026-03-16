import { afterEach, describe, expect, test } from "bun:test";
import type { TurnEvent } from "../llm-api/types.ts";
import { renderError, renderUserMessage } from "./output.ts";
import { Spinner } from "./spinner.ts";
import { renderTurn } from "./stream-render.ts";
import {
	captureStdout,
	getCapturedStdout,
	restoreStdout,
	simulateTerminal,
	stripAnsi,
} from "./test-helpers.ts";
import { renderToolCall, renderToolResult } from "./tool-render.ts";

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

function done(): TurnEvent {
	return {
		type: "turn-complete",
		inputTokens: 10,
		outputTokens: 20,
		contextTokens: 100,
		messages: [],
	};
}

function shellResult(opts: {
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

// ─── Visual hierarchy documentation ───────────────────────────────────────────
//
// The output hierarchy from the user's perspective should be:
//
//   [0-indent] › user message          (green ›)
//   [0-indent] · reasoning             (dim · header)
//   [2-space]    reasoning body text    (dim italic)
//   [0-indent] ◆ assistant reply       (cyan ◆)
//   [2-space]  $ shell command          (dim $, tool call)
//   [2-space]  ⇢ subagent prompt       (cyan ⇢, tool call)
//   [4-space]    done exit 0 · ...     (tool result badge)
//   [4-space]    stderr (N lines)      (tool result preview label)
//   [4-space]    │ preview line         (tool result preview content)
//   [0-indent] · info message           (dim ·)
//   [0-indent] ✖ error message          (red ✖)
//   [2-space]    hint text              (dim hint)
//   [0-indent] · context pruned ...     (dim ·)
//
// Between blocks (reasoning→text, text→tool, tool→reasoning, etc.):
// A single blank line separates visually distinct blocks.

describe("UI audit: output hierarchy", () => {
	describe("user message rendering", () => {
		test("single-line message has › prefix at column 0", () => {
			captureStdout();
			renderUserMessage("hello world");
			expect(stripAnsi(getCapturedStdout())).toBe("› hello world\n");
		});

		test("multi-line message indents continuations with 2 spaces", () => {
			captureStdout();
			renderUserMessage("line 1\nline 2\nline 3");
			expect(stripAnsi(getCapturedStdout())).toBe(
				"› line 1\n  line 2\n  line 3\n",
			);
		});
	});

	describe("tool call rendering", () => {
		test("shell call is indented 2 spaces with $ glyph", () => {
			captureStdout();
			renderToolCall("shell", { command: "echo hi" });
			expect(stripAnsi(getCapturedStdout())).toBe("  $ echo hi\n");
		});

		test("subagent call is indented 2 spaces with ⇢ glyph", () => {
			captureStdout();
			renderToolCall("subagent", {
				prompt: "Review code",
				agentName: "reviewer",
			});
			const plain = stripAnsi(getCapturedStdout());
			expect(plain).toStartWith("  ⇢");
			expect(plain).toContain("[@reviewer]");
			expect(plain).toContain("Review code");
		});

		test("readSkill call is indented 2 spaces with ← glyph", () => {
			captureStdout();
			renderToolCall("readSkill", { name: "deploy" });
			const plain = stripAnsi(getCapturedStdout());
			expect(plain).toStartWith("  ←");
			expect(plain).toContain("read skill");
			expect(plain).toContain("deploy");
		});

		test("MCP tool call is indented 2 spaces with ⚙ glyph", () => {
			captureStdout();
			renderToolCall("mcp_myserver_do_thing", { arg: "val" });
			const plain = stripAnsi(getCapturedStdout());
			expect(plain).toStartWith("  ⚙");
		});
	});

	describe("tool result rendering", () => {
		test("successful shell result badge is indented 4 spaces", () => {
			captureStdout();
			renderToolResult("shell", shellResult({ stdout: "ok" }), false);
			const plain = stripAnsi(getCapturedStdout());
			expect(plain).toMatch(/^ {4}done/m);
		});

		test("failed shell result badge is indented 4 spaces", () => {
			captureStdout();
			renderToolResult(
				"shell",
				shellResult({ stderr: "fail", exitCode: 1, success: false }),
				false,
			);
			const plain = stripAnsi(getCapturedStdout());
			expect(plain).toMatch(/^ {4}error/m);
		});

		test("shell stderr preview lines are indented 4 spaces with │", () => {
			captureStdout();
			renderToolResult(
				"shell",
				shellResult({ stderr: "bad\nstuff", exitCode: 1, success: false }),
				false,
			);
			const plain = stripAnsi(getCapturedStdout());
			expect(plain).toContain("    │ bad");
			expect(plain).toContain("    │ stuff");
		});

		test("shell stdout preview lines are indented 4 spaces with │", () => {
			captureStdout();
			renderToolResult("shell", shellResult({ stdout: "line1\nline2" }), false);
			const plain = stripAnsi(getCapturedStdout());
			expect(plain).toContain("    │ line1");
			expect(plain).toContain("    │ line2");
		});

		test("tool error badge is indented 4 spaces", () => {
			captureStdout();
			renderToolResult("shell", "something broke", true);
			const plain = stripAnsi(getCapturedStdout());
			expect(plain).toMatch(/^ {4}✖/m);
		});

		test("subagent result is indented 4 spaces", () => {
			captureStdout();
			renderToolResult(
				"subagent",
				{ inputTokens: 100, outputTokens: 50, agentName: "reviewer" },
				false,
			);
			const plain = stripAnsi(getCapturedStdout());
			expect(plain).toMatch(/^ {4}⇢/m);
		});
	});

	describe("error rendering", () => {
		test("error headline is at column 0 with ✖ glyph", () => {
			captureStdout();
			renderError("something went wrong");
			const plain = stripAnsi(getCapturedStdout());
			expect(plain).toMatch(/^✖ something went wrong/m);
		});
	});
});

describe("UI audit: full turn scenarios", () => {
	test("simple text reply: reasoning → reply with blank line separator", async () => {
		captureStdout();

		await renderTurn(
			eventsFrom([
				{ type: "reasoning-delta", delta: "Let me think" },
				{ type: "text-delta", delta: "Here is the answer." },
				done(),
			]),
			new Spinner(),
		);

		const plain = simulateTerminal(getCapturedStdout());
		expect(plain).toBe(
			"· reasoning\n  Let me think\n\n◆ Here is the answer.\n",
		);
	});

	test("tool use: tool-call → tool-result → reply", async () => {
		captureStdout();

		await renderTurn(
			eventsFrom([
				{
					type: "tool-call-start",
					toolName: "shell",
					toolCallId: "t1",
					args: { command: "ls" },
				},
				{
					type: "tool-result",
					toolName: "shell",
					toolCallId: "t1",
					isError: false,
					result: shellResult({ stdout: "file.txt" }),
				},
				{ type: "text-delta", delta: "Found file.txt" },
				done(),
			]),
			new Spinner(),
		);

		const plain = simulateTerminal(getCapturedStdout());
		// Tool call at 2-space indent
		expect(plain).toContain("  $ ls");
		// Tool result at 4-space indent
		expect(plain).toMatch(/^ {4}done/m);
		// Reply at 0-indent with blank line before
		expect(plain).toContain("\n\n◆ Found file.txt");
	});

	test("multiple tools: each tool-call/result pair is visually grouped", async () => {
		captureStdout();

		await renderTurn(
			eventsFrom([
				{
					type: "tool-call-start",
					toolName: "shell",
					toolCallId: "t1",
					args: { command: "cat a.txt" },
				},
				{
					type: "tool-result",
					toolName: "shell",
					toolCallId: "t1",
					isError: false,
					result: shellResult({ stdout: "hello" }),
				},
				{
					type: "tool-call-start",
					toolName: "shell",
					toolCallId: "t2",
					args: { command: "cat b.txt" },
				},
				{
					type: "tool-result",
					toolName: "shell",
					toolCallId: "t2",
					isError: false,
					result: shellResult({ stdout: "world" }),
				},
				done(),
			]),
			new Spinner(),
		);

		const plain = simulateTerminal(getCapturedStdout());
		// Both tool calls present
		expect(plain).toContain("  $ cat a.txt");
		expect(plain).toContain("  $ cat b.txt");
		// Blank line between first result and second call
		const lines = plain.split("\n");
		const firstResultIdx = lines.findIndex((l) =>
			l.match(/^ {4}done.*out: hello/),
		);
		const secondCallIdx = lines.findIndex((l) => l.includes("$ cat b.txt"));
		expect(firstResultIdx).toBeGreaterThan(-1);
		expect(secondCallIdx).toBeGreaterThan(firstResultIdx);
		// There should be a blank line between the first result and second tool call
		const between = lines.slice(firstResultIdx + 1, secondCallIdx);
		expect(between.some((l) => l.trim() === "")).toBe(true);
	});

	test("reasoning → tool → reasoning → reply: two reasoning blocks", async () => {
		captureStdout();

		await renderTurn(
			eventsFrom([
				{ type: "reasoning-delta", delta: "plan A" },
				{
					type: "tool-call-start",
					toolName: "shell",
					toolCallId: "t1",
					args: { command: "echo test" },
				},
				{
					type: "tool-result",
					toolName: "shell",
					toolCallId: "t1",
					isError: false,
					result: shellResult({ stdout: "test" }),
				},
				{ type: "reasoning-delta", delta: "plan B" },
				{ type: "text-delta", delta: "done" },
				done(),
			]),
			new Spinner(),
		);

		const plain = simulateTerminal(getCapturedStdout());
		// Two separate reasoning blocks
		const reasoningCount = (plain.match(/· reasoning/g) ?? []).length;
		expect(reasoningCount).toBe(2);
		expect(plain).toContain("plan A");
		expect(plain).toContain("plan B");
	});

	test("context-pruned event renders at 0-indent with · glyph", async () => {
		captureStdout();

		await renderTurn(
			eventsFrom([
				{
					type: "context-pruned",
					mode: "balanced",
					beforeMessageCount: 100,
					afterMessageCount: 80,
					removedMessageCount: 20,
					beforeTotalBytes: 30000,
					afterTotalBytes: 20000,
					removedBytes: 10000,
				},
				{ type: "text-delta", delta: "continuing" },
				done(),
			]),
			new Spinner(),
		);

		const plain = simulateTerminal(getCapturedStdout());
		expect(plain).toContain("· context pruned");
		expect(plain).toContain("balanced");
		expect(plain).toContain("–20 messages");
	});

	test("text reply with no reasoning: just ◆ prefix", async () => {
		captureStdout();

		await renderTurn(
			eventsFrom([{ type: "text-delta", delta: "Hello!" }, done()]),
			new Spinner(),
		);

		const plain = simulateTerminal(getCapturedStdout());
		expect(plain).toBe("◆ Hello!\n");
	});

	test("tool error shows ✖ at 4-space indent", async () => {
		captureStdout();

		await renderTurn(
			eventsFrom([
				{
					type: "tool-call-start",
					toolName: "shell",
					toolCallId: "t1",
					args: { command: "bad-cmd" },
				},
				{
					type: "tool-result",
					toolName: "shell",
					toolCallId: "t1",
					isError: true,
					result: "command not found",
				},
				done(),
			]),
			new Spinner(),
		);

		const plain = simulateTerminal(getCapturedStdout());
		expect(plain).toContain("  $ bad-cmd");
		expect(plain).toMatch(/^ {4}✖ command not found/m);
	});

	test("empty turn (no text, no tools) still outputs a newline", async () => {
		captureStdout();

		await renderTurn(eventsFrom([done()]), new Spinner());

		const raw = getCapturedStdout();
		expect(raw).toContain("\n");
	});
});

describe("UI audit: spinner does not leak into output", () => {
	test("spinner stop is called before every rendered line", async () => {
		captureStdout();
		const spinner = new Spinner();
		let stopCalls = 0;
		const originalStop = spinner.stop.bind(spinner);
		spinner.stop = () => {
			stopCalls++;
			originalStop();
		};

		await renderTurn(
			eventsFrom([
				{ type: "reasoning-delta", delta: "think" },
				{
					type: "tool-call-start",
					toolName: "shell",
					toolCallId: "t1",
					args: { command: "echo hi" },
				},
				{
					type: "tool-result",
					toolName: "shell",
					toolCallId: "t1",
					isError: false,
					result: shellResult({ stdout: "hi" }),
				},
				{ type: "text-delta", delta: "answer" },
				done(),
			]),
			spinner,
		);

		// Spinner should have been stopped at least once for each visible block:
		// reasoning, tool-call, tool-result, text
		expect(stopCalls).toBeGreaterThanOrEqual(4);
	});
});

describe("UI audit: consistent indentation depths", () => {
	test("all tool call types share 2-space indent", () => {
		const tools = [
			{ name: "shell", args: { command: "ls" } },
			{ name: "subagent", args: { prompt: "do stuff" } },
			{ name: "readSkill", args: { name: "deploy" } },
			{ name: "listSkills", args: {} },
			{ name: "mcp_server_tool", args: {} },
		];

		for (const tool of tools) {
			captureStdout();
			renderToolCall(tool.name, tool.args);
			const plain = stripAnsi(getCapturedStdout());
			expect(plain).toMatch(/^ {2}\S/m);
			restoreStdout();
		}
	});

	test("all tool result types start at 4-space indent", () => {
		const results: Array<{ name: string; result: unknown }> = [
			{ name: "shell", result: shellResult({ stdout: "ok" }) },
			{
				name: "subagent",
				result: { inputTokens: 10, outputTokens: 5 },
			},
			{
				name: "listSkills",
				result: {
					skills: [{ name: "x", description: "y", source: "local" }],
				},
			},
			{
				name: "readSkill",
				result: {
					skill: { name: "x", description: "y", source: "local" },
				},
			},
		];

		for (const { name, result } of results) {
			captureStdout();
			renderToolResult(name, result, false);
			const plain = stripAnsi(getCapturedStdout());
			const firstLine = plain.split("\n")[0] ?? "";
			expect(firstLine).toMatch(/^ {4}\S/);
			restoreStdout();
		}
	});
});
