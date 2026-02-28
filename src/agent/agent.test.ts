import { describe, expect, test } from "bun:test";
import type { CoreMessage } from "../llm-api/turn.ts";
import { extractAssistantText, hasRalphSignal } from "./agent.ts";

// ─── extractAssistantText ─────────────────────────────────────────────────────

describe("extractAssistantText", () => {
	test("returns empty string for empty message list", () => {
		expect(extractAssistantText([])).toBe("");
	});

	test("returns empty string when no assistant messages present", () => {
		const msgs: CoreMessage[] = [{ role: "user", content: "hello" }];
		expect(extractAssistantText(msgs)).toBe("");
	});

	test("extracts string content from an assistant message", () => {
		const msgs: CoreMessage[] = [
			{ role: "assistant", content: "All done. /ralph" },
		];
		expect(extractAssistantText(msgs)).toBe("All done. /ralph");
	});

	test("extracts text parts from array content", () => {
		const msgs: CoreMessage[] = [
			{
				role: "assistant",
				content: [
					{ type: "text", text: "I will run the tests." },
					{ type: "tool-call", toolCallId: "1", toolName: "shell", input: {} },
				],
			},
		];
		expect(extractAssistantText(msgs)).toBe("I will run the tests.");
	});

	test("concatenates text across multiple assistant messages", () => {
		const msgs: CoreMessage[] = [
			{ role: "user", content: "go" },
			{ role: "assistant", content: "Fixing the bug." },
			{ role: "assistant", content: "All done. /ralph" },
		];
		expect(extractAssistantText(msgs)).toBe(
			"Fixing the bug.\nAll done. /ralph",
		);
	});

	test("returns empty string when assistant message has no text parts", () => {
		const msgs: CoreMessage[] = [
			{
				role: "assistant",
				content: [
					{ type: "tool-call", toolCallId: "1", toolName: "shell", input: {} },
				],
			},
		];
		expect(extractAssistantText(msgs)).toBe("");
	});

	test("captures /ralph even when the last content part is a tool call", () => {
		// Typical agentic pattern: text block followed by a trailing tool call
		const msgs: CoreMessage[] = [
			{
				role: "assistant",
				content: [
					{ type: "text", text: "Tests pass. /ralph" },
					{ type: "tool-call", toolCallId: "1", toolName: "shell", input: {} },
				],
			},
		];
		expect(extractAssistantText(msgs)).toBe("Tests pass. /ralph");
	});
});

// ─── hasRalphSignal ───────────────────────────────────────────────────────────

describe("hasRalphSignal", () => {
	test("returns false for empty string", () => {
		expect(hasRalphSignal("")).toBe(false);
	});

	test("returns true for bare /ralph", () => {
		expect(hasRalphSignal("/ralph")).toBe(true);
	});

	test("returns true when /ralph has trailing whitespace", () => {
		expect(hasRalphSignal("/ralph  \n")).toBe(true);
	});

	test("returns true when /ralph is preceded by prose", () => {
		expect(hasRalphSignal("All tests pass. /ralph")).toBe(true);
	});

	test("returns true when /ralph appears mid-text", () => {
		expect(hasRalphSignal("Done. /ralph\nSee you.")).toBe(true);
	});

	test("returns false when /ralphy (not a word boundary)", () => {
		expect(hasRalphSignal("/ralphy")).toBe(false);
	});

	test("returns false for unrelated text", () => {
		expect(hasRalphSignal("I finished the task.")).toBe(false);
	});
});

// ─── Ctrl+C / interrupt handling ──────────────────────────────────────────────
//
// Behaviour contract:
//   • During an LLM turn, Ctrl+C cancels the turn and returns to the prompt.
//   • Ctrl+C when no turn is active exits the process.
//
// Architecture:
//   watchForInterrupt() (input.ts) sets stdin to raw mode and listens for
//   byte 0x03 (Ctrl+C) directly — no SIGINT involved.  This sidesteps Bun's
//   unreliable SIGINT delivery when stdin is in raw mode.
//   registerTerminalCleanup() (output.ts) handles SIGINT for the idle case
//   (non-TTY, subprocesses sending SIGINT, etc.) and simply calls process.exit.
//
// These tests verify the AbortController / abort-signal wiring independently
// of the actual TTY/stdin machinery.

describe("interrupt via AbortController", () => {
	test("aborting the controller sets wasAborted via signal listener", () => {
		const controller = new AbortController();
		let wasAborted = false;
		controller.signal.addEventListener("abort", () => {
			wasAborted = true;
		});
		expect(wasAborted).toBe(false);
		controller.abort();
		expect(wasAborted).toBe(true);
	});

	test("abort is idempotent — repeated aborts do not throw", () => {
		const controller = new AbortController();
		controller.abort();
		expect(() => controller.abort()).not.toThrow();
		expect(controller.signal.aborted).toBe(true);
	});

	test("signal.aborted reflects abort state correctly", () => {
		const controller = new AbortController();
		expect(controller.signal.aborted).toBe(false);
		controller.abort();
		expect(controller.signal.aborted).toBe(true);
	});
});
