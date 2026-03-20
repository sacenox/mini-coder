type StreamChunk = { type?: string; [key: string]: unknown };

export function getReasoningDeltaFromStreamChunk(
  chunk: StreamChunk,
): string | null {
  if (chunk.type !== "reasoning-delta" && chunk.type !== "reasoning") {
    return null;
  }
  if (typeof chunk.text === "string") return chunk.text;
  if (typeof chunk.textDelta === "string") return chunk.textDelta;
  if (typeof chunk.delta === "string") return chunk.delta;
  return "";
}
