import { getReasoningDeltaFromStreamChunk } from "./history-transforms.ts";
import type { TurnEvent } from "./types.ts";

type StreamChunk = { type?: string; [key: string]: unknown };

export function shouldLogStreamChunk(c: StreamChunk): boolean {
	return (
		c.type !== "text-delta" &&
		c.type !== "reasoning" &&
		c.type !== "reasoning-delta"
	);
}

export function mapStreamChunkToTurnEvent(c: StreamChunk): TurnEvent | null {
	switch (c.type) {
		case "text-delta": {
			const delta = typeof c.text === "string" ? c.text : "";
			return {
				type: "text-delta",
				delta,
			};
		}
		case "reasoning-delta":
		case "reasoning": {
			const delta = getReasoningDeltaFromStreamChunk(c);
			if (delta === null) return null;
			return {
				type: "reasoning-delta",
				delta,
			};
		}
		case "tool-input-start":
		case "tool-call": {
			const toolName = String(c.toolName ?? "");
			const toolCallId = String(c.toolCallId ?? "");
			return {
				type: "tool-call-start",
				toolCallId,
				toolName,
				args: c.input ?? c.args,
			};
		}
		case "tool-result": {
			return {
				type: "tool-result",
				toolCallId: String(c.toolCallId ?? ""),
				toolName: String(c.toolName ?? ""),
				result: "output" in c ? c.output : "result" in c ? c.result : undefined,
				isError: "isError" in c ? Boolean(c.isError) : false,
			};
		}
		case "tool-error":
			return {
				type: "tool-result",
				toolCallId: String(c.toolCallId ?? ""),
				toolName: String(c.toolName ?? ""),
				result: c.error ?? "Tool execution failed",
				isError: true,
			};
		case "error": {
			const err = c.error;
			throw err instanceof Error ? err : new Error(String(err));
		}
		default:
			return null;
	}
}
