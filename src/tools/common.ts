import type { ImageContent } from "@earendil-works/pi-ai";

export interface ToolContext {
  signal: AbortSignal;
  /** Whether the current model accepts image input. */
  supportsImages: boolean;
  onOutput?: (chunk: string) => void;
}

export interface ToolResult {
  text: string;
  isError: boolean;
  /** Image blocks appended to the tool result, after `text`. */
  images?: ImageContent[];
}
