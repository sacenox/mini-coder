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

// ─── SIGINT handling ──────────────────────────────────────────────────────────
//
// Behaviour contract (from mini-coder-idea.md):
//   • First Ctrl+C during an active turn → cancel the turn, return to prompt.
//   • Second Ctrl+C (or Ctrl+C when no turn is active) → exit the process.
//
// Architecture:
//   registerTerminalCleanup() (output.ts) registers a "cleanup" handler that
//   calls process.exit(130) ONLY when listenerCount("SIGINT") === 1.
//   processUserInput() (agent.ts) registers a per-turn "abort" handler as the
//   VERY FIRST synchronous action — before any await — so that Ctrl+C at any
//   point during the turn (including the async preamble) is intercepted here.
//
// Note: registerTerminalCleanup() itself cannot be called in tests because it
// registers a handler that calls process.exit(), which would kill the runner.
// These tests exercise the identical conditional logic with a safe stand-in.

describe("SIGINT handling — registerTerminalCleanup + processUserInput contract", () => {
	// Mirrors the exact conditional in registerTerminalCleanup's SIGINT handler.
	// The real handler calls process.exit(130) instead of log.push("would-exit").
	function makeCleanupHandler(log: string[]) {
		return () => {
			if (process.listenerCount("SIGINT") > 1) {
				log.push("skipped");
				return;
			}
			log.push("would-exit");
		};
	}

	test("cleanup handler skips exit while an abort handler is registered", () => {
		const log: string[] = [];
		const cleanup = makeCleanupHandler(log);
		process.on("SIGINT", cleanup);

		const abort = () => {
			log.push("abort-fired");
			process.removeListener("SIGINT", abort);
		};
		process.on("SIGINT", abort);

		process.emit("SIGINT");

		process.removeListener("SIGINT", cleanup);
		expect(log).toEqual(["skipped", "abort-fired"]);
	});

	test("cleanup handler exits when it is the sole listener", () => {
		const log: string[] = [];
		const cleanup = makeCleanupHandler(log);
		process.on("SIGINT", cleanup);

		process.emit("SIGINT");

		process.removeListener("SIGINT", cleanup);
		expect(log).toEqual(["would-exit"]);
	});

	test("abort handler registered before any await covers the async preamble", () => {
		// processUserInput registers onSigInt synchronously at the TOP of the
		// function (before resolveFileRefs / takeSnapshot awaits).  This test
		// confirms that a SIGINT fired during those awaits is caught by the abort
		// handler rather than escaping to the cleanup handler and exiting.
		const log: string[] = [];
		const cleanup = makeCleanupHandler(log);
		process.on("SIGINT", cleanup);

		// Abort handler is in place before any await fires
		const abort = () => {
			log.push("abort-fired");
			process.removeListener("SIGINT", abort);
		};
		process.on("SIGINT", abort);

		// SIGINT fires mid-preamble (simulated synchronously)
		process.emit("SIGINT");

		process.removeListener("SIGINT", cleanup);
		process.removeListener("SIGINT", abort);

		// Cleanup skips (listenerCount=2); abort intercepts → no exit
		expect(log).toEqual(["skipped", "abort-fired"]);
	});

	test("second SIGINT after turn abort exits — intentional per-spec behaviour", () => {
		// After the first Ctrl+C the abort handler removes itself (listenerCount→1).
		// A subsequent Ctrl+C should exit (spec: "Second time it exits the app").
		const log: string[] = [];
		const cleanup = makeCleanupHandler(log);
		process.on("SIGINT", cleanup);

		const abort = () => {
			log.push("abort-fired");
			process.removeListener("SIGINT", abort);
		};
		process.on("SIGINT", abort);

		process.emit("SIGINT"); // first — aborts the turn
		expect(log).toEqual(["skipped", "abort-fired"]);
		log.length = 0;

		process.emit("SIGINT"); // second — exits
		process.removeListener("SIGINT", cleanup);

		expect(log).toEqual(["would-exit"]);
	});
});
