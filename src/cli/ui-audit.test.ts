import { afterEach, describe, expect, test } from "bun:test";
import { renderError } from "./output.ts";
import { Spinner } from "./spinner.ts";
import { renderTurn } from "./stream-render.ts";
import {
	captureStdout,
	eventsFrom,
	getCapturedStdout,
	restoreStdout,
	shellResult,
	simulateTerminal,
	stripAnsi,
	turnDone,
} from "./test-helpers.ts";
import { renderToolCall, renderToolResult } from "./tool-render.ts";

afterEach(() => {
	restoreStdout();
});

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
				turnDone(),
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
				turnDone(),
			]),
			new Spinner(),
		);

		const plain = simulateTerminal(getCapturedStdout());
		expect(plain).toContain("  ← ls");
		expect(plain).toMatch(/^ {4}done/m);
		expect(plain).toContain("\n\n◆ Found file.txt");
	});

	test("multiple sequential tools: blank line between result and next call", async () => {
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
				turnDone(),
			]),
			new Spinner(),
		);

		const plain = simulateTerminal(getCapturedStdout());
		const lines = plain.split("\n");
		const firstResultIdx = lines.findIndex((l) =>
			l.match(/^ {4}done.*out: hello/),
		);
		const secondCallIdx = lines.findIndex((l) => l.includes("← cat b.txt"));
		expect(firstResultIdx).toBeGreaterThan(-1);
		expect(secondCallIdx).toBeGreaterThan(firstResultIdx);
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
				turnDone(),
			]),
			new Spinner(),
		);

		const plain = simulateTerminal(getCapturedStdout());
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
				turnDone(),
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
			eventsFrom([{ type: "text-delta", delta: "Hello!" }, turnDone()]),
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
				turnDone(),
			]),
			new Spinner(),
		);

		const plain = simulateTerminal(getCapturedStdout());
		expect(plain).toContain("  $ bad-cmd");
		expect(plain).toMatch(/^ {4}✖ command not found/m);
	});

	test("empty turn (no text, no tools) still outputs a newline", async () => {
		captureStdout();

		await renderTurn(eventsFrom([turnDone()]), new Spinner());

		const raw = getCapturedStdout();
		expect(raw).toContain("\n");
	});
});

describe("UI audit: parallel tool calls", () => {
	test("two parallel shell calls render both calls before any results", async () => {
		captureStdout();

		await renderTurn(
			eventsFrom([
				{
					type: "tool-call-start",
					toolName: "shell",
					toolCallId: "p1",
					args: { command: "echo alpha" },
				},
				{
					type: "tool-call-start",
					toolName: "shell",
					toolCallId: "p2",
					args: { command: "echo bravo" },
				},
				{
					type: "tool-result",
					toolName: "shell",
					toolCallId: "p1",
					isError: false,
					result: shellResult({ stdout: "alpha" }),
				},
				{
					type: "tool-result",
					toolName: "shell",
					toolCallId: "p2",
					isError: false,
					result: shellResult({ stdout: "bravo" }),
				},
				{ type: "text-delta", delta: "Both done." },
				turnDone(),
			]),
			new Spinner(),
		);

		const plain = simulateTerminal(getCapturedStdout());
		const lines = plain.split("\n");

		// Both tool calls appear before the first result
		const call1 = lines.findIndex((l) => l.includes("$ echo alpha"));
		const call2 = lines.findIndex((l) => l.includes("$ echo bravo"));
		const result1 = lines.findIndex((l) => l.match(/^ {4}done.*alpha/));
		const result2 = lines.findIndex((l) => l.match(/^ {4}done.*bravo/));

		expect(call1).toBeGreaterThan(-1);
		expect(call2).toBeGreaterThan(-1);
		expect(result1).toBeGreaterThan(-1);
		expect(result2).toBeGreaterThan(-1);

		// Calls come before results
		expect(call1).toBeLessThan(result1);
		expect(call2).toBeLessThan(result2);

		// Both calls appear before first result
		expect(call2).toBeLessThan(result1);

		// Reply follows
		expect(plain).toContain("◆ Both done.");
	});

	test("three parallel mixed tools: shell + subagent + readSkill", async () => {
		captureStdout();

		await renderTurn(
			eventsFrom([
				{
					type: "tool-call-start",
					toolName: "shell",
					toolCallId: "m1",
					args: { command: "ls src" },
				},
				{
					type: "tool-call-start",
					toolName: "subagent",
					toolCallId: "m2",
					args: { prompt: "Analyze code" },
				},
				{
					type: "tool-call-start",
					toolName: "readSkill",
					toolCallId: "m3",
					args: { name: "deploy" },
				},
				{
					type: "tool-result",
					toolName: "shell",
					toolCallId: "m1",
					isError: false,
					result: shellResult({ stdout: "index.ts" }),
				},
				{
					type: "tool-result",
					toolName: "subagent",
					toolCallId: "m2",
					isError: false,
					result: { inputTokens: 50, outputTokens: 30 },
				},
				{
					type: "tool-result",
					toolName: "readSkill",
					toolCallId: "m3",
					isError: false,
					result: {
						skill: {
							name: "deploy",
							description: "Deploy stuff",
							source: "local",
						},
					},
				},
				turnDone(),
			]),
			new Spinner(),
		);

		const plain = simulateTerminal(getCapturedStdout());

		// All three calls rendered
		expect(plain).toContain("  ← ls src");
		expect(plain).toMatch(/^ {2}⇢/m);
		expect(plain).toMatch(/^ {2}←/m);

		// All three results at 4-space indent
		expect(plain).toMatch(/^ {4}done.*index\.ts/m);
		expect(plain).toMatch(/^ {4}⇢/m);
		// readSkill result uses · (info) glyph
		expect(plain).toMatch(/^ {4}·/m);
	});

	test("parallel calls: no blank line between consecutive tool calls in a batch", async () => {
		captureStdout();

		await renderTurn(
			eventsFrom([
				{
					type: "tool-call-start",
					toolName: "shell",
					toolCallId: "s1",
					args: { command: "echo one" },
				},
				{
					type: "tool-call-start",
					toolName: "shell",
					toolCallId: "s2",
					args: { command: "echo two" },
				},
				{
					type: "tool-result",
					toolName: "shell",
					toolCallId: "s1",
					isError: false,
					result: shellResult({ stdout: "one" }),
				},
				{
					type: "tool-result",
					toolName: "shell",
					toolCallId: "s2",
					isError: false,
					result: shellResult({ stdout: "two" }),
				},
				turnDone(),
			]),
			new Spinner(),
		);

		const plain = simulateTerminal(getCapturedStdout());
		const lines = plain.split("\n");

		// Consecutive parallel tool calls should be adjacent (no blank line)
		const idx1 = lines.findIndex((l) => l.includes("$ echo one"));
		const idx2 = lines.findIndex((l) => l.includes("$ echo two"));
		expect(idx2).toBe(idx1 + 1);
	});

	test("parallel calls with one error and one success", async () => {
		captureStdout();

		await renderTurn(
			eventsFrom([
				{
					type: "tool-call-start",
					toolName: "shell",
					toolCallId: "e1",
					args: { command: "good-cmd" },
				},
				{
					type: "tool-call-start",
					toolName: "shell",
					toolCallId: "e2",
					args: { command: "bad-cmd" },
				},
				{
					type: "tool-result",
					toolName: "shell",
					toolCallId: "e1",
					isError: false,
					result: shellResult({ stdout: "ok" }),
				},
				{
					type: "tool-result",
					toolName: "shell",
					toolCallId: "e2",
					isError: true,
					result: "permission denied",
				},
				{ type: "text-delta", delta: "Partial failure." },
				turnDone(),
			]),
			new Spinner(),
		);

		const plain = simulateTerminal(getCapturedStdout());
		expect(plain).toContain("  $ good-cmd");
		expect(plain).toContain("  $ bad-cmd");
		expect(plain).toMatch(/^ {4}done/m);
		expect(plain).toMatch(/^ {4}✖ permission denied/m);
		expect(plain).toContain("◆ Partial failure.");
	});

	test("parallel results show ↳ label to identify which call each belongs to", async () => {
		captureStdout();

		await renderTurn(
			eventsFrom([
				{
					type: "tool-call-start",
					toolName: "shell",
					toolCallId: "lbl1",
					args: { command: "echo first" },
				},
				{
					type: "tool-call-start",
					toolName: "shell",
					toolCallId: "lbl2",
					args: { command: "echo second" },
				},
				{
					type: "tool-result",
					toolName: "shell",
					toolCallId: "lbl1",
					isError: false,
					result: shellResult({ stdout: "first" }),
				},
				{
					type: "tool-result",
					toolName: "shell",
					toolCallId: "lbl2",
					isError: false,
					result: shellResult({ stdout: "second" }),
				},
				turnDone(),
			]),
			new Spinner(),
		);

		const plain = simulateTerminal(getCapturedStdout());
		// Both results get ↳ labels
		expect(plain).toContain("↳ $ echo first");
		expect(plain).toContain("↳ $ echo second");
	});

	test("sequential tool results do NOT show ↳ labels", async () => {
		captureStdout();

		await renderTurn(
			eventsFrom([
				{
					type: "tool-call-start",
					toolName: "shell",
					toolCallId: "seq1",
					args: { command: "echo one" },
				},
				{
					type: "tool-result",
					toolName: "shell",
					toolCallId: "seq1",
					isError: false,
					result: shellResult({ stdout: "one" }),
				},
				{
					type: "tool-call-start",
					toolName: "shell",
					toolCallId: "seq2",
					args: { command: "echo two" },
				},
				{
					type: "tool-result",
					toolName: "shell",
					toolCallId: "seq2",
					isError: false,
					result: shellResult({ stdout: "two" }),
				},
				turnDone(),
			]),
			new Spinner(),
		);

		const plain = simulateTerminal(getCapturedStdout());
		expect(plain).not.toContain("↳");
	});

	test("reasoning → parallel calls → reasoning → reply", async () => {
		captureStdout();

		await renderTurn(
			eventsFrom([
				{ type: "reasoning-delta", delta: "I'll check two files" },
				{
					type: "tool-call-start",
					toolName: "shell",
					toolCallId: "r1",
					args: { command: "cat a.ts" },
				},
				{
					type: "tool-call-start",
					toolName: "shell",
					toolCallId: "r2",
					args: { command: "cat b.ts" },
				},
				{
					type: "tool-result",
					toolName: "shell",
					toolCallId: "r1",
					isError: false,
					result: shellResult({ stdout: "content A" }),
				},
				{
					type: "tool-result",
					toolName: "shell",
					toolCallId: "r2",
					isError: false,
					result: shellResult({ stdout: "content B" }),
				},
				{ type: "reasoning-delta", delta: "Now I understand" },
				{ type: "text-delta", delta: "Here's my analysis." },
				turnDone(),
			]),
			new Spinner(),
		);

		const plain = simulateTerminal(getCapturedStdout());

		// Reasoning block before tools
		expect(plain).toContain("· reasoning");
		expect(plain).toContain("I'll check two files");

		// Both parallel calls
		expect(plain).toContain("← cat a.ts");
		expect(plain).toContain("← cat b.ts");

		// Second reasoning block
		const reasoningCount = (plain.match(/· reasoning/g) ?? []).length;
		expect(reasoningCount).toBe(2);
		expect(plain).toContain("Now I understand");

		// Final reply
		expect(plain).toContain("◆ Here's my analysis.");
	});
});

describe("UI audit: spinner", () => {
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
				turnDone(),
			]),
			spinner,
		);

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

	test("single-line failing shell does not duplicate stdout", () => {
		captureStdout();
		renderToolResult(
			"shell",
			shellResult({
				stdout: "error TS2322: Type mismatch",
				exitCode: 1,
				success: false,
			}),
			false,
		);
		const plain = stripAnsi(getCapturedStdout());
		// Summary line should inline the single stdout line
		expect(plain).toContain("out: error TS2322");
		// Should NOT also show a separate stdout preview block
		expect(plain).not.toContain("stdout (1 lines)");
		expect(plain.match(/error TS2322/g)?.length).toBe(1);
	});

	test("multi-line failing shell still shows stdout preview", () => {
		captureStdout();
		renderToolResult(
			"shell",
			shellResult({
				stdout: "line1\nline2\nline3",
				exitCode: 1,
				success: false,
			}),
			false,
		);
		const plain = stripAnsi(getCapturedStdout());
		expect(plain).toContain("stdout 3L");
		expect(plain).toContain("stdout (3 lines)");
		expect(plain).toContain("│ line1");
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
