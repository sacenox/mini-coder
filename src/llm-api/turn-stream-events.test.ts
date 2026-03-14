import { describe, expect, test } from "bun:test";
import {
	mapStreamChunkToTurnEvent,
	shouldLogStreamChunk,
} from "./turn-stream-events.ts";

describe("shouldLogStreamChunk", () => {
	test("suppresses text and reasoning deltas", () => {
		expect(shouldLogStreamChunk({ type: "text-delta" })).toBe(false);
		expect(shouldLogStreamChunk({ type: "reasoning" })).toBe(false);
		expect(shouldLogStreamChunk({ type: "reasoning-delta" })).toBe(false);
		expect(shouldLogStreamChunk({ type: "tool-call" })).toBe(true);
	});
});

describe("mapStreamChunkToTurnEvent", () => {
	test("maps text deltas", () => {
		expect(
			mapStreamChunkToTurnEvent({ type: "text-delta", text: "hello" }),
		).toEqual({
			type: "text-delta",
			delta: "hello",
		});
	});

	test("maps tool call events using input or args", () => {
		expect(
			mapStreamChunkToTurnEvent({
				type: "tool-call",
				toolCallId: "id-1",
				toolName: "read",
				input: { path: "a.ts" },
			}),
		).toEqual({
			type: "tool-call-start",
			toolCallId: "id-1",
			toolName: "read",
			args: { path: "a.ts" },
		});
		expect(
			mapStreamChunkToTurnEvent({
				type: "tool-input-start",
				toolCallId: "id-2",
				toolName: "read",
				args: { path: "b.ts" },
			}),
		).toEqual({
			type: "tool-call-start",
			toolCallId: "id-2",
			toolName: "read",
			args: { path: "b.ts" },
		});
	});

	test("ignores empty tool-input-start chunks", () => {
		expect(
			mapStreamChunkToTurnEvent({
				type: "tool-input-start",
				toolCallId: "id-empty",
				toolName: "shell",
				input: {},
			}),
		).toBeNull();
	});

	test("maps tool-result events from output/result and preserves isError", () => {
		expect(
			mapStreamChunkToTurnEvent({
				type: "tool-result",
				toolCallId: "id-2",
				toolName: "shell",
				output: { ok: true },
				isError: 1,
			}),
		).toEqual({
			type: "tool-result",
			toolCallId: "id-2",
			toolName: "shell",
			result: { ok: true },
			isError: true,
		});
	});

	test("maps tool-error to tool-result error", () => {
		expect(
			mapStreamChunkToTurnEvent({
				type: "tool-error",
				toolCallId: "id-3",
				toolName: "replace",
				error: "bad anchor",
			}),
		).toEqual({
			type: "tool-result",
			toolCallId: "id-3",
			toolName: "replace",
			result: "bad anchor",
			isError: true,
		});
	});

	test("throws on stream error chunks", () => {
		expect(() =>
			mapStreamChunkToTurnEvent({ type: "error", error: new Error("boom") }),
		).toThrow("boom");
	});
});
