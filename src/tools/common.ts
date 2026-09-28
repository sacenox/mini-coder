import type { ImageContent } from "@earendil-works/pi-ai";

export interface ToolContext {
  signal: AbortSignal;
  /** Whether the current model accepts image input. */
  supportsImages: boolean;
  onOutput?: (chunk: string) => void;
}

/** One changed file, display-only; never reaches the model. */
export interface FileDiff {
  /** Path relative to the working directory. */
  path: string;
  /** Unified diff body; absent when content cannot be tracked. */
  patch?: string;
  /** Why no patch is available, e.g. "binary file changed". */
  note?: string;
}

export interface ToolResult {
  text: string;
  isError: boolean;
  /** Image blocks appended to the tool result, after `text`. */
  images?: ImageContent[];
  /** Files the tool changed under the working directory, for display only. */
  diffs?: FileDiff[];
}
