import { describe, expect, test } from "bun:test";
import { getTurnControlAction } from "../cli/input.ts";
import type { CoreMessage } from "../llm-api/turn.ts";
import {
	extractAssistantText,
	hasRalphSignal,
	makeInterruptMessage,
} from "./agent-helpers.ts";

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

// ─── getTurnControlAction ─────────────────────────────────────────────────────

describe("getTurnControlAction", () => {
	test("returns cancel for ESC byte (0x1B)", () => {
		expect(getTurnControlAction(Buffer.from([0x1b]))).toBe("cancel");
	});

	test("returns quit for Ctrl+C byte (0x03)", () => {
		expect(getTurnControlAction(Buffer.from([0x03]))).toBe("quit");
	});

	test("returns null for regular printable bytes", () => {
		expect(getTurnControlAction(Buffer.from([0x61]))).toBeNull(); // 'a'
	});

	test("returns null for multi-byte ESC sequence (arrow keys, function keys)", () => {
		// Arrow-up: ESC [ A — should NOT cancel
		expect(getTurnControlAction(Buffer.from([0x1b, 0x5b, 0x41]))).toBeNull();
		// Arrow-down: ESC [ B
		expect(getTurnControlAction(Buffer.from([0x1b, 0x5b, 0x42]))).toBeNull();
	});

	test("returns null for two-byte ESC sequence", () => {
		expect(getTurnControlAction(Buffer.from([0x1b, 0x66]))).toBeNull(); // Alt+f
	});

	test("returns quit for Ctrl+C even in multi-byte chunk", () => {
		expect(getTurnControlAction(Buffer.from([0x61, 0x03, 0x62]))).toBe("quit");
	});

	test("returns null for empty buffer", () => {
		expect(getTurnControlAction(Buffer.from([]))).toBeNull();
	});
});

// ─── makeInterruptMessage ─────────────────────────────────────────────────────

describe("makeInterruptMessage", () => {
	test("user reason produces an assistant role message", () => {
		const msg = makeInterruptMessage("user");
		expect(msg.role).toBe("assistant");
	});

	test("error reason produces an assistant role message", () => {
		const msg = makeInterruptMessage("error");
		expect(msg.role).toBe("assistant");
	});

	test("user reason content contains system-message tag", () => {
		const msg = makeInterruptMessage("user");
		expect(msg.content).toContain("<system-message>");
		expect(msg.content).toContain("</system-message>");
		expect(msg.content).toContain("interrupted by the user");
	});

	test("error reason content contains system-message tag", () => {
		const msg = makeInterruptMessage("error");
		expect(msg.content).toContain("<system-message>");
		expect(msg.content).toContain("</system-message>");
		expect(msg.content).toContain("interrupted due to an error");
	});

	test("user and error produce different messages", () => {
		expect(makeInterruptMessage("user").content).not.toBe(
			makeInterruptMessage("error").content,
		);
	});
});
