import { describe, expect, test } from "bun:test";
import { mapFullStreamToTurnEvents } from "./turn-execution.ts";
import type { TurnEvent } from "./types.ts";

function chunksFrom(
	chunks: Array<{ type?: string; [key: string]: unknown }>,
): AsyncIterable<{ type?: string; [key: string]: unknown }> {
	return (async function* () {
		for (const chunk of chunks) {
			yield chunk;
		}
	})();
}

async function collectEvents(
	chunks: Array<{ type?: string; [key: string]: unknown }>,
): Promise<TurnEvent[]> {
	const events: TurnEvent[] = [];
	for await (const event of mapFullStreamToTurnEvents(chunksFrom(chunks), {})) {
		events.push(event);
	}
	return events;
}

describe("mapFullStreamToTurnEvents", () => {
	test("synthesizes missing toolCallId and reuses it for matching result", async () => {
		const events = await collectEvents([
			{ type: "tool-call", toolName: "read", input: { path: "a.ts" } },
			{ type: "tool-result", toolName: "read", output: { ok: true } },
		]);

		expect(events).toHaveLength(2);
		expect(events[0]).toMatchObject({
			type: "tool-call-start",
			toolName: "read",
		});
		expect(events[1]).toMatchObject({ type: "tool-result", toolName: "read" });

		const start = events[0] as Extract<TurnEvent, { type: "tool-call-start" }>;
		const result = events[1] as Extract<TurnEvent, { type: "tool-result" }>;

		expect(start.toolCallId).toMatch(/^synthetic-tool-call-\d+$/);
		expect(result.toolCallId).toBe(start.toolCallId);
	});

	test("uses explicit tool call id when result id is missing", async () => {
		const events = await collectEvents([
			{ type: "tool-call", toolCallId: "call-1", toolName: "shell", input: {} },
			{ type: "tool-result", toolName: "shell", output: "done" },
		]);

		expect(events).toHaveLength(2);
		const result = events[1] as Extract<TurnEvent, { type: "tool-result" }>;
		expect(result.toolCallId).toBe("call-1");
	});

	test("prefers tool-call over empty tool-input-start chunks", async () => {
		const events = await collectEvents([
			{
				type: "tool-input-start",
				toolCallId: "call-2",
				toolName: "shell",
				input: {},
			},
			{
				type: "tool-call",
				toolCallId: "call-2",
				toolName: "shell",
				input: { command: "ls -1" },
			},
			{
				type: "tool-result",
				toolCallId: "call-2",
				toolName: "shell",
				output: "ok",
			},
		]);

		expect(events).toHaveLength(2);
		expect(events[0]).toMatchObject({
			type: "tool-call-start",
			toolCallId: "call-2",
			toolName: "shell",
			args: { command: "ls -1" },
		});
		expect(events[1]).toMatchObject({
			type: "tool-result",
			toolCallId: "call-2",
			toolName: "shell",
		});
	});

	test("suppresses commentary text deltas for openai phased text parts", async () => {
		const events = await collectEvents([
			{
				type: "text-start",
				id: "msg-1",
				providerMetadata: { openai: { itemId: "msg-1", phase: "commentary" } },
			},
			{ type: "text-delta", id: "msg-1", text: "to=functions.shell json{}" },
			{
				type: "text-end",
				id: "msg-1",
				providerMetadata: { openai: { itemId: "msg-1", phase: "commentary" } },
			},
			{
				type: "tool-call",
				toolCallId: "call-3",
				toolName: "shell",
				input: { command: "echo hi" },
			},
			{
				type: "tool-result",
				toolCallId: "call-3",
				toolName: "shell",
				output: "hi",
			},
			{
				type: "text-start",
				id: "msg-2",
				providerMetadata: {
					openai: { itemId: "msg-2", phase: "final_answer" },
				},
			},
			{ type: "text-delta", id: "msg-2", text: "Done" },
			{
				type: "text-end",
				id: "msg-2",
				providerMetadata: {
					openai: { itemId: "msg-2", phase: "final_answer" },
				},
			},
		]);

		expect(events).toEqual([
			{
				type: "tool-call-start",
				toolCallId: "call-3",
				toolName: "shell",
				args: { command: "echo hi" },
			},
			{
				type: "tool-result",
				toolCallId: "call-3",
				toolName: "shell",
				result: "hi",
				isError: false,
			},
			{ type: "text-delta", delta: "Done" },
		]);
	});

	test("keeps unphased text deltas visible", async () => {
		const events = await collectEvents([
			{ type: "text-delta", id: "msg-plain", text: "visible" },
		]);

		expect(events).toEqual([{ type: "text-delta", delta: "visible" }]);
	});
});
