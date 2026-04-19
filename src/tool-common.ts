/**
 * Shared helpers for built-in tool implementations.
 *
 * @module
 */

import type {
  ImageContent,
  Static,
  TextContent,
  Tool,
  ToolCall,
  TSchema,
} from "@mariozechner/pi-ai";
import { validateToolArguments } from "@mariozechner/pi-ai";

/**
 * Result from executing a tool.
 *
 * Content blocks carry either text or image data. The agent loop maps these
 * directly into pi-ai tool-result content.
 */
export interface ToolExecResult {
  /** Content blocks for the tool result. */
  content: (TextContent | ImageContent)[];
  /** Optional structured metadata preserved on the tool-result message. */
  details?: unknown;
  /** Whether the execution encountered an error. */
  isError: boolean;
}

/**
 * Build a text-only tool result.
 *
 * @param text - Message text to return in the tool result.
 * @param isError - Whether the result represents a tool error.
 * @returns Text-only tool result content.
 */
export function textResult(text: string, isError: boolean): ToolExecResult {
  return { content: [{ type: "text", text }], isError };
}

/**
 * Detect which line ending a text blob uses.
 *
 * @param content - Text to inspect.
 * @returns The first detected line ending, or `null` when the text is single-line.
 */
export function detectLineEnding(content: string): "\n" | "\r\n" | null {
  if (content.includes("\r\n")) {
    return "\r\n";
  }
  if (content.includes("\n")) {
    return "\n";
  }
  return null;
}

/**
 * Normalize line endings to a specific style.
 *
 * @param content - Text to normalize.
 * @param lineEnding - Target line ending sequence.
 * @returns Text using only the requested line ending style.
 */
export function normalizeLineEndings(
  content: string,
  lineEnding: "\n" | "\r\n",
): string {
  if (lineEnding === "\r\n") {
    return content.replace(/\r?\n/g, "\r\n");
  }
  return content.replace(/\r\n/g, "\n");
}

/**
 * Validate and coerce built-in tool arguments against a typed TypeBox schema.
 *
 * @param tool - Built-in tool definition.
 * @param args - Raw parsed tool-call arguments from the model.
 * @returns Validated arguments typed from the tool schema.
 */
export function validateBuiltinToolArgs<TParameters extends TSchema>(
  tool: Tool<TParameters>,
  args: Record<string, unknown>,
): Static<TParameters> {
  return validateToolArguments(tool, {
    type: "toolCall",
    id: tool.name,
    name: tool.name,
    arguments: args,
  } satisfies ToolCall) as Static<TParameters>;
}
