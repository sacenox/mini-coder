import type { ImageContent, Static, TSchema } from "@earendil-works/pi-ai";
import { Value } from "typebox/value";

export interface ToolContext {
  signal: AbortSignal;
  /** Whether the current model accepts image input. */
  supportsImages: boolean;
  onOutput?: (chunk: string) => void;
}

export interface ToolDetails {
  truncated: boolean;
  omittedChars: number;
  totalChars: number;
}

export interface ToolResult {
  text: string;
  isError: boolean;
  details?: ToolDetails;
  /** Image blocks appended to the tool result, after `text`. */
  images?: ImageContent[];
}

export function parseArgs<T extends TSchema>(schema: T, value: unknown): Static<T> {
  try {
    return Value.Parse(schema, value);
  } catch {
    const first = [...Value.Errors(schema, value)][0];
    throw new Error(first ? `${first.instancePath || "/"} ${first.message}` : "invalid arguments");
  }
}
