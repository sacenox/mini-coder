const MAX_TOOL_OUTPUT_CHARS = 16_000;
const TOOL_OUTPUT_TRUNCATION_MARKER = "\n\n... tool output truncated ...\n\n";
const TOOL_OUTPUT_PREVIEW_CHARS =
  MAX_TOOL_OUTPUT_CHARS - TOOL_OUTPUT_TRUNCATION_MARKER.length;
const TOOL_OUTPUT_HEAD_CHARS = Math.ceil((TOOL_OUTPUT_PREVIEW_CHARS * 2) / 3);
const TOOL_OUTPUT_TAIL_CHARS =
  TOOL_OUTPUT_PREVIEW_CHARS - TOOL_OUTPUT_HEAD_CHARS;

type ToolOutputBuffer = {
  head: string;
  tail: string;
  streamedChars: number;
  streamTruncated: boolean;
  truncated: boolean;
};

function splitsSurrogatePair(text: string, index: number): boolean {
  const previous = text.charCodeAt(index - 1);
  const next = text.charCodeAt(index);
  return (
    previous >= 0xd800 && previous <= 0xdbff && next >= 0xdc00 && next <= 0xdfff
  );
}

function takePrefix(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;

  const end = splitsSurrogatePair(text, maxChars) ? maxChars - 1 : maxChars;
  return text.slice(0, end);
}

function takeSuffix(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;

  const requestedStart = text.length - maxChars;
  const start = splitsSurrogatePair(text, requestedStart)
    ? requestedStart + 1
    : requestedStart;
  return text.slice(start);
}

function limitStreamDelta(buffer: ToolOutputBuffer, text: string): string {
  if (buffer.streamTruncated) return "";

  const remaining = TOOL_OUTPUT_PREVIEW_CHARS - buffer.streamedChars;
  if (text.length <= remaining) {
    buffer.streamedChars += text.length;
    return text;
  }

  const prefix = takePrefix(text, remaining);
  buffer.streamedChars += prefix.length;
  buffer.streamTruncated = true;
  return `${prefix}${TOOL_OUTPUT_TRUNCATION_MARKER}`;
}

export function createToolOutputBuffer(): ToolOutputBuffer {
  return {
    head: "",
    tail: "",
    streamedChars: 0,
    streamTruncated: false,
    truncated: false,
  };
}

export function appendToolOutput(
  buffer: ToolOutputBuffer,
  text: string,
): string {
  const streamDelta = limitStreamDelta(buffer, text);

  if (!buffer.truncated) {
    const combined = buffer.head + text;
    if (combined.length <= MAX_TOOL_OUTPUT_CHARS) {
      buffer.head = combined;
      return streamDelta;
    }

    buffer.head = takePrefix(combined, TOOL_OUTPUT_HEAD_CHARS);
    buffer.tail = takeSuffix(combined, TOOL_OUTPUT_TAIL_CHARS);
    buffer.truncated = true;
    return streamDelta;
  }

  buffer.tail = takeSuffix(`${buffer.tail}${text}`, TOOL_OUTPUT_TAIL_CHARS);
  return streamDelta;
}

export function renderToolOutput(buffer: ToolOutputBuffer): string {
  if (!buffer.truncated) return buffer.head;
  return `${buffer.head}${TOOL_OUTPUT_TRUNCATION_MARKER}${buffer.tail}`;
}

export function truncateToolOutput(text: string): string {
  const buffer = createToolOutputBuffer();
  appendToolOutput(buffer, text);
  return renderToolOutput(buffer);
}
