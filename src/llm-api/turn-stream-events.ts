import { normalizeUnknownError } from "./error-utils.ts";
import { getReasoningDeltaFromStreamChunk } from "./history-transforms.ts";
import type { TurnEvent } from "./types.ts";

type StreamChunk = { type?: string; [key: string]: unknown };

export function shouldLogStreamChunk(c: StreamChunk): boolean {
  return (
    c.type !== "text-delta" &&
    c.type !== "reasoning" &&
    c.type !== "reasoning-delta" &&
    c.type !== "tool-input-delta"
  );
}

export function extractToolArgs(c: StreamChunk): unknown {
  return c.input ?? c.args;
}

export function hasRenderableToolArgs(args: unknown): boolean {
  if (args === null || args === undefined) return false;
  if (typeof args === "string") return args.trim().length > 0;
  if (Array.isArray(args)) return args.length > 0;
  if (typeof args === "object") return Object.keys(args).length > 0;
  return true;
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
    case "tool-input-start": {
      const args = extractToolArgs(c);
      const hasStableToolCallId =
        typeof c.toolCallId === "string" && c.toolCallId.trim().length > 0;
      if (hasStableToolCallId && !hasRenderableToolArgs(args)) return null;
      return {
        type: "tool-call-start",
        toolCallId: String(c.toolCallId ?? ""),
        toolName: String(c.toolName ?? ""),
        args,
      };
    }
    case "tool-input-delta": {
      let delta = "";
      if (typeof c.inputTextDelta === "string") {
        delta = c.inputTextDelta;
      } else if (typeof c.delta === "string") {
        delta = c.delta;
      }
      if (!delta) return null;
      return {
        type: "tool-input-delta",
        toolCallId: String(c.toolCallId ?? c.id ?? ""),
        toolName: String(c.toolName ?? ""),
        inputTextDelta: delta,
      };
    }
    case "tool-call": {
      return {
        type: "tool-call-start",
        toolCallId: String(c.toolCallId ?? ""),
        toolName: String(c.toolName ?? ""),
        args: extractToolArgs(c),
      };
    }
    case "tool-result": {
      let result: unknown;
      if ("output" in c) result = c.output;
      else if ("result" in c) result = c.result;
      return {
        type: "tool-result",
        toolCallId: String(c.toolCallId ?? ""),
        toolName: String(c.toolName ?? ""),
        result,
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
      throw normalizeUnknownError(c.error);
    }
    default:
      return null;
  }
}
