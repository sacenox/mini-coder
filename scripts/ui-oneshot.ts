#!/usr/bin/env bun
/**
 * Manual one-shot UI test: renders example scenarios to stdout
 * so you can visually inspect the console output.
 *
 * Usage: bun scripts/ui-oneshot.ts
 */
import type { TurnEvent } from "../src/llm-api/types.ts";
import { renderBanner, renderError, renderUserMessage, writeln } from "../src/cli/output.ts";
import { Spinner } from "../src/cli/spinner.ts";
import { renderTurn } from "../src/cli/stream-render.ts";
import { renderToolCall, renderToolResult } from "../src/cli/tool-render.ts";

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
		inputTokens: 1234,
		outputTokens: 567,
		contextTokens: 50000,
		messages: [],
	};
}

function shell(opts: {
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

function separator(title: string) {
	writeln(`\n${"─".repeat(60)}`);
	writeln(`  ${title}`);
	writeln(`${"─".repeat(60)}\n`);
}

async function main() {
	// ── Banner ──────────────────────────────────────────────
	separator("1. Banner");
	renderBanner("claude-sonnet-4-20250514", "~/projects/my-app");

	// ── User message ───────────────────────────────────────
	separator("2. User message (single line)");
	renderUserMessage("Fix the failing tests in src/utils.ts");

	separator("3. User message (multi-line)");
	renderUserMessage(
		"Please review these files:\n- src/index.ts\n- src/utils.ts\n- src/config.ts",
	);

	// ── Simple text reply ──────────────────────────────────
	separator("4. Simple text reply (no reasoning)");
	await renderTurn(
		eventsFrom([
			{ type: "text-delta", delta: "I'll take a look at those files for you." },
			done(),
		]),
		new Spinner(),
	);

	// ── Reasoning + text reply ─────────────────────────────
	separator("5. Reasoning → text reply");
	await renderTurn(
		eventsFrom([
			{
				type: "reasoning-delta",
				delta:
					"The user wants me to fix failing tests. Let me check the test file first to understand the failures.",
			},
			{
				type: "text-delta",
				delta:
					"I'll start by examining the test file to understand what's failing.",
			},
			done(),
		]),
		new Spinner(),
	);

	// ── Single tool call ───────────────────────────────────
	separator("6. Single tool call (shell)");
	await renderTurn(
		eventsFrom([
			{
				type: "tool-call-start",
				toolName: "shell",
				toolCallId: "t1",
				args: { command: "bun test src/utils.test.ts 2>&1 | tail -20" },
			},
			{
				type: "tool-result",
				toolName: "shell",
				toolCallId: "t1",
				isError: false,
				result: shell({
					stdout:
						"src/utils.test.ts:\n(pass) parseConfig > handles defaults\n(fail) parseConfig > validates required fields\n(pass) parseConfig > merges overrides\n\n 2 pass\n 1 fail\n 5 expect() calls",
					exitCode: 1,
					success: false,
				}),
			},
			{
				type: "text-delta",
				delta:
					"I can see one test is failing. Let me look at the test to understand the expected behavior.",
			},
			done(),
		]),
		new Spinner(),
	);

	// ── Parallel tool calls ────────────────────────────────
	separator("7. Parallel tool calls (2 shells)");
	await renderTurn(
		eventsFrom([
			{
				type: "reasoning-delta",
				delta: "I need to read both the source and test file to understand the issue.",
			},
			{
				type: "tool-call-start",
				toolName: "shell",
				toolCallId: "p1",
				args: { command: "cat src/utils.ts" },
			},
			{
				type: "tool-call-start",
				toolName: "shell",
				toolCallId: "p2",
				args: { command: "cat src/utils.test.ts" },
			},
			{
				type: "tool-result",
				toolName: "shell",
				toolCallId: "p1",
				isError: false,
				result: shell({
					stdout:
						'export function parseConfig(raw: unknown): Config {\n  if (typeof raw !== "object" || raw === null) {\n    throw new Error("invalid config");\n  }\n  return { ...defaults, ...raw };\n}',
				}),
			},
			{
				type: "tool-result",
				toolName: "shell",
				toolCallId: "p2",
				isError: false,
				result: shell({
					stdout:
						'test("validates required fields", () => {\n  expect(() => parseConfig(null)).toThrow("invalid config");\n  expect(() => parseConfig({})).toThrow("missing required");\n});',
				}),
			},
			{
				type: "text-delta",
				delta:
					"Found the issue! The test expects `parseConfig({})` to throw `\"missing required\"`, but the function only throws for non-objects.",
			},
			done(),
		]),
		new Spinner(),
	);

	// ── Parallel mixed tools ───────────────────────────────
	separator("8. Parallel mixed tools (shell + subagent + readSkill)");
	await renderTurn(
		eventsFrom([
			{
				type: "tool-call-start",
				toolName: "shell",
				toolCallId: "m1",
				args: { command: "wc -l src/**/*.ts" },
			},
			{
				type: "tool-call-start",
				toolName: "subagent",
				toolCallId: "m2",
				args: { prompt: "Review the error handling patterns in src/", agentName: "reviewer" },
			},
			{
				type: "tool-call-start",
				toolName: "readSkill",
				toolCallId: "m3",
				args: { name: "testing" },
			},
			{
				type: "tool-result",
				toolName: "shell",
				toolCallId: "m1",
				isError: false,
				result: shell({
					stdout: "  142 src/index.ts\n   87 src/utils.ts\n   45 src/config.ts\n  274 total",
				}),
			},
			{
				type: "tool-result",
				toolName: "subagent",
				toolCallId: "m2",
				isError: false,
				result: { inputTokens: 2500, outputTokens: 800, agentName: "reviewer" },
			},
			{
				type: "tool-result",
				toolName: "readSkill",
				toolCallId: "m3",
				isError: false,
				result: {
					skill: { name: "testing", description: "Testing best practices", source: "local" },
				},
			},
			{
				type: "text-delta",
				delta: "Based on the code review and testing guidelines, here are my recommendations.",
			},
			done(),
		]),
		new Spinner(),
	);

	// ── Tool error ─────────────────────────────────────────
	separator("9. Tool call with error");
	await renderTurn(
		eventsFrom([
			{
				type: "tool-call-start",
				toolName: "shell",
				toolCallId: "e1",
				args: { command: "rm -rf /protected" },
			},
			{
				type: "tool-result",
				toolName: "shell",
				toolCallId: "e1",
				isError: true,
				result: "permission denied: /protected",
			},
			{
				type: "text-delta",
				delta: "I don't have permission to modify that directory.",
			},
			done(),
		]),
		new Spinner(),
	);

	// ── Parallel with mixed success/error ──────────────────
	separator("10. Parallel calls: one success, one error");
	await renderTurn(
		eventsFrom([
			{
				type: "tool-call-start",
				toolName: "shell",
				toolCallId: "x1",
				args: { command: "cat README.md" },
			},
			{
				type: "tool-call-start",
				toolName: "shell",
				toolCallId: "x2",
				args: { command: "cat MISSING.md" },
			},
			{
				type: "tool-result",
				toolName: "shell",
				toolCallId: "x1",
				isError: false,
				result: shell({ stdout: "# My Project\n\nA cool project." }),
			},
			{
				type: "tool-result",
				toolName: "shell",
				toolCallId: "x2",
				isError: false,
				result: shell({
					stderr: "cat: MISSING.md: No such file or directory",
					exitCode: 1,
					success: false,
				}),
			},
			{
				type: "text-delta",
				delta: "README exists but MISSING.md doesn't. Let me create it.",
			},
			done(),
		]),
		new Spinner(),
	);

	// ── Context pruned ─────────────────────────────────────
	separator("11. Context pruned event");
	await renderTurn(
		eventsFrom([
			{
				type: "context-pruned",
				mode: "balanced",
				beforeMessageCount: 120,
				afterMessageCount: 80,
				removedMessageCount: 40,
				beforeTotalBytes: 65536,
				afterTotalBytes: 40960,
				removedBytes: 24576,
			},
			{
				type: "text-delta",
				delta: "I've been working on this for a while. Let me continue where I left off.",
			},
			done(),
		]),
		new Spinner(),
	);

	// ── Error rendering ────────────────────────────────────
	separator("12. Error messages");
	renderError("API rate limit exceeded. Retrying in 30s...");
	writeln("");
	renderError("Connection timed out after 60s", "Check your network connection and try again.");

	// ── MCP tool ───────────────────────────────────────────
	separator("13. MCP tool call");
	await renderTurn(
		eventsFrom([
			{
				type: "tool-call-start",
				toolName: "mcp_github_create_issue",
				toolCallId: "mcp1",
				args: { repo: "my-org/my-repo", title: "Fix validation bug", body: "..." },
			},
			{
				type: "tool-result",
				toolName: "mcp_github_create_issue",
				toolCallId: "mcp1",
				isError: false,
				result: { url: "https://github.com/my-org/my-repo/issues/42" },
			},
			{
				type: "text-delta",
				delta: "Created issue #42 for tracking the validation bug.",
			},
			done(),
		]),
		new Spinner(),
	);

	// ── Full realistic session ─────────────────────────────
	separator("14. Realistic multi-turn snippet");
	renderUserMessage("Fix the type error in src/config.ts");
	writeln("");
	await renderTurn(
		eventsFrom([
			{
				type: "reasoning-delta",
				delta: "Let me look at the file to find the type error.",
			},
			{
				type: "tool-call-start",
				toolName: "shell",
				toolCallId: "r1",
				args: { command: "bun run typecheck 2>&1 | grep 'config.ts'" },
			},
			{
				type: "tool-result",
				toolName: "shell",
				toolCallId: "r1",
				isError: false,
				result: shell({
					stdout:
						"src/config.ts(12,5): error TS2322: Type 'string' is not assignable to type 'number'.",
					exitCode: 1,
					success: false,
				}),
			},
			{
				type: "reasoning-delta",
				delta:
					"Line 12 has a type mismatch. The port should be a number but is being set as a string.",
			},
			{
				type: "tool-call-start",
				toolName: "shell",
				toolCallId: "r2",
				args: { command: "sed -n '10,15p' src/config.ts" },
			},
			{
				type: "tool-result",
				toolName: "shell",
				toolCallId: "r2",
				isError: false,
				result: shell({
					stdout:
						'  const config = {\n    host: env.HOST ?? "localhost",\n    port: env.PORT ?? "3000",\n    debug: env.DEBUG === "true",\n  };',
				}),
			},
			{
				type: "tool-call-start",
				toolName: "shell",
				toolCallId: "r3",
				args: {
					command:
						'mc-edit src/config.ts --old \'port: env.PORT ?? "3000"\' --new \'port: Number(env.PORT ?? "3000")\'',
				},
			},
			{
				type: "tool-result",
				toolName: "shell",
				toolCallId: "r3",
				isError: false,
				result: shell({ stdout: "ok: true\npath: src/config.ts\nchanged: true" }),
			},
			{
				type: "tool-call-start",
				toolName: "shell",
				toolCallId: "r4",
				args: { command: "bun run typecheck 2>&1" },
			},
			{
				type: "tool-result",
				toolName: "shell",
				toolCallId: "r4",
				isError: false,
				result: shell({ stdout: "" }),
			},
			{
				type: "text-delta",
				delta:
					'Fixed the type error on line 12 of `src/config.ts`. The `port` field was being assigned a string from `env.PORT ?? "3000"` — wrapped it in `Number()` to coerce to the expected `number` type. Typecheck passes now.',
			},
			done(),
		]),
		new Spinner(),
	);

	writeln("");
}

main();
