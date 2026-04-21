/**
 * Built-in tool implementations: `shell`, `delegate`, `read`, `grep`, `edit`,
 * `todoWrite`, `todoRead`, and `readImage`.
 *
 * Shell, delegate, read, and grep live in dedicated modules and are re-exported
 * here so the rest of the codebase can keep a single built-in-tools import
 * surface.
 *
 * Each tool is exposed as a pure-ish execute function that takes typed
 * arguments and a working directory, returning a result object. The pi-ai
 * {@link Tool} definitions (TypeBox schemas) are exported separately for
 * registration with the agent context.
 *
 * @module
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, extname, isAbsolute, join } from "node:path";
import { crc32, inflateSync } from "node:zlib";
import type {
  Message,
  Static,
  TextContent,
  Tool,
  ToolResultMessage,
} from "@mariozechner/pi-ai";
import { Type } from "@mariozechner/pi-ai";
import type { ToolHandler } from "./agent.ts";
import {
  detectLineEnding,
  normalizeLineEndings,
  type ToolExecResult,
  textResult,
  validateBuiltinToolArgs,
} from "./tool-common.ts";

export type { ToolExecResult } from "./tool-common.ts";
export {
  type CreateDelegateToolHandlerOpts,
  createDelegateToolHandler,
  type DelegateArgs,
  type DelegateResultDetails,
  type DelegateRunResult,
  delegateTool,
  formatDelegateResultText,
} from "./tool-delegate.ts";
export {
  DEFAULT_GREP_LIMIT,
  executeGrep,
  type GrepArgs,
  type GrepOpts,
  type GrepResult,
  type GrepResultFile,
  type GrepResultLine,
  grepTool,
  grepToolHandler,
  parseGrepResult,
} from "./tool-grep.ts";
export {
  DEFAULT_READ_LIMIT,
  executeRead,
  formatReadContinuationHint,
  parseReadContinuationHint,
  parseReadResult,
  type ReadArgs,
  type ReadContinuationHint,
  type ReadOpts,
  readTool,
  readToolHandler,
} from "./tool-read.ts";
export {
  createDelegationAwareShellToolHandler,
  type DelegationAwareShellToolHandlerOpts,
  executeShell,
  formatShellResultText,
  parseLegacyShellResult,
  parseShellResultDetails,
  type ShellArgs,
  type ShellOpts,
  type ShellResultDetails,
  shellTool,
  shellToolHandler,
  truncateOutput,
} from "./tool-shell.ts";

/** Persisted todo status values shown to the user and stored in snapshots. */
export type TodoStatus = "pending" | "in_progress" | "completed";

/** Todo status values accepted by `todoWrite`. */
export type TodoWriteStatus = TodoStatus | "cancelled";

/** A single persisted todo item. */
export interface TodoItem {
  /** Task description shown in the checklist. */
  content: string;
  /** Current persisted task status. */
  status: TodoStatus;
}

const todoWriteToolParameters = Type.Object({
  todos: Type.Array(
    Type.Object({
      content: Type.String({
        description: "Task description used as the matching key",
      }),
      status: Type.Union(
        [
          Type.Literal("pending"),
          Type.Literal("in_progress"),
          Type.Literal("completed"),
          Type.Literal("cancelled"),
        ],
        {
          description:
            "Task status. Use `cancelled` to remove the item entirely.",
        },
      ),
    }),
    {
      description:
        "List of todo items to create, update, or remove. Only send the items that changed.",
    },
  ),
});

/** Arguments for the `todoWrite` tool. */
export type TodoWriteArgs = Static<typeof todoWriteToolParameters>;

const todoReadToolParameters = Type.Object({});

const MAX_TODO_CONTENT_LENGTH = 1_000;

type TodoHistoryMessage = Message | { role: "ui" };

function isTodoStatus(value: unknown): value is TodoStatus {
  return (
    value === "pending" || value === "in_progress" || value === "completed"
  );
}

function isTodoWriteStatus(value: unknown): value is TodoWriteStatus {
  return value === "cancelled" || isTodoStatus(value);
}

function cloneTodoItems(todos: readonly TodoItem[]): TodoItem[] {
  return todos.map((todo) => ({ ...todo }));
}

function getToolResultText(content: ToolResultMessage["content"]): string {
  return content
    .filter((entry): entry is TextContent => entry.type === "text")
    .map((entry) => entry.text)
    .join("\n");
}

/** Serialize a full todo snapshot for storage in a tool result. */
export function formatTodoSnapshot(todos: readonly TodoItem[]): string {
  return JSON.stringify({ todos: cloneTodoItems(todos) }, null, 2);
}

/** Parse a serialized todo snapshot from tool-result text. */
export function parseTodoSnapshot(text: string): TodoItem[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return null;
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !Array.isArray((parsed as { todos?: unknown }).todos)
  ) {
    return null;
  }

  const todos = (parsed as { todos: unknown[] }).todos;
  if (
    !todos.every((todo) => {
      return (
        typeof todo === "object" &&
        todo !== null &&
        typeof (todo as { content?: unknown }).content === "string" &&
        isTodoStatus((todo as { status?: unknown }).status)
      );
    })
  ) {
    return null;
  }

  return todos.map((todo) => ({
    content: (todo as { content: string }).content,
    status: (todo as { status: TodoStatus }).status,
  }));
}

function getTodoSnapshotFromToolResult(
  message: ToolResultMessage,
): TodoItem[] | null {
  if (message.isError) {
    return null;
  }
  if (message.toolName !== "todoWrite" && message.toolName !== "todoRead") {
    return null;
  }
  return parseTodoSnapshot(getToolResultText(message.content));
}

/** Return the current todo list derived from persisted message history. */
export function getTodoItems(
  messages: readonly TodoHistoryMessage[],
): TodoItem[] {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || message.role !== "toolResult") {
      continue;
    }

    const snapshot = getTodoSnapshotFromToolResult(message);
    if (snapshot) {
      return snapshot;
    }
  }

  return [];
}

function validateTodoContent(content: string): string | null {
  if (content.trim().length === 0) {
    return "Todo content cannot be empty";
  }
  if (content.length > MAX_TODO_CONTENT_LENGTH) {
    return `Todo content exceeds maximum length of ${MAX_TODO_CONTENT_LENGTH} characters`;
  }
  return null;
}

/** Apply incremental todo changes and return the new full snapshot. */
export function executeTodoWrite(
  args: TodoWriteArgs,
  messages: readonly TodoHistoryMessage[],
): ToolExecResult {
  const nextTodos = cloneTodoItems(getTodoItems(messages));

  for (const todo of args.todos) {
    const validationError = validateTodoContent(todo.content);
    if (validationError) {
      return textResult(validationError, true);
    }
    if (!isTodoWriteStatus(todo.status)) {
      return textResult(`Invalid todo status: ${String(todo.status)}`, true);
    }

    if (todo.status === "cancelled") {
      const index = nextTodos.findIndex(
        (existingTodo) => existingTodo.content === todo.content,
      );
      if (index !== -1) {
        nextTodos.splice(index, 1);
      }
      continue;
    }

    const existingTodo = nextTodos.find(
      (candidate) => candidate.content === todo.content,
    );
    if (existingTodo) {
      existingTodo.status = todo.status;
      continue;
    }

    nextTodos.push({
      content: todo.content,
      status: todo.status,
    });
  }

  return textResult(formatTodoSnapshot(nextTodos), false);
}

/** Return the current full todo snapshot without mutating it. */
export function executeTodoRead(
  messages: readonly TodoHistoryMessage[],
): ToolExecResult {
  return textResult(formatTodoSnapshot(getTodoItems(messages)), false);
}

const MAX_EDIT_ERROR_MATCHES = 3;
const MAX_EDIT_ERROR_SNIPPET_LINES = 8;
const MAX_EDIT_ERROR_SNIPPET_LINE_CHARS = 160;
const MIN_EDIT_SIMILARITY_SCORE = 0.45;

interface EditSnippet {
  startLine: number;
  endLine: number;
  lines: string[];
}

function splitDisplayLines(content: string): string[] {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  if (lines.at(-1) === "") {
    lines.pop();
  }
  return lines;
}

function countDisplayLines(content: string): number {
  return Math.max(splitDisplayLines(content).length, 1);
}

function formatLineRange(startLine: number, endLine: number): string {
  return startLine === endLine
    ? `line ${startLine}`
    : `lines ${startLine}-${endLine}`;
}

function truncateSnippetLine(line: string): string {
  if (line.length <= MAX_EDIT_ERROR_SNIPPET_LINE_CHARS) {
    return line;
  }
  return `${line.slice(0, MAX_EDIT_ERROR_SNIPPET_LINE_CHARS - 1)}…`;
}

function formatSnippetLines(lines: readonly string[]): string {
  const visibleLines = lines.slice(0, MAX_EDIT_ERROR_SNIPPET_LINES);
  const formatted = visibleLines
    .map((line) => `  ${truncateSnippetLine(line)}`)
    .join("\n");
  const hiddenLineCount = lines.length - visibleLines.length;
  if (hiddenLineCount <= 0) {
    return formatted;
  }
  return `${formatted}\n  … ${hiddenLineCount} more lines`;
}

function commonPrefixLength(a: string, b: string): number {
  let index = 0;
  const maxLength = Math.min(a.length, b.length);
  while (index < maxLength && a[index] === b[index]) {
    index++;
  }
  return index;
}

function commonSuffixLength(
  a: string,
  b: string,
  prefixLength: number,
): number {
  let index = 0;
  const maxLength = Math.min(a.length, b.length) - prefixLength;
  while (
    index < maxLength &&
    a[a.length - 1 - index] === b[b.length - 1 - index]
  ) {
    index++;
  }
  return index;
}

function scoreSimilarLine(oldLine: string, candidateLine: string): number {
  if (oldLine === candidateLine) {
    return 1;
  }

  const normalizedOldLine = oldLine.trim();
  const normalizedCandidateLine = candidateLine.trim();
  if (normalizedOldLine === normalizedCandidateLine) {
    return normalizedOldLine === "" ? 1 : 0.98;
  }
  if (normalizedOldLine === "" || normalizedCandidateLine === "") {
    return 0;
  }

  const prefixLength = commonPrefixLength(
    normalizedOldLine,
    normalizedCandidateLine,
  );
  const suffixLength = commonSuffixLength(
    normalizedOldLine,
    normalizedCandidateLine,
    prefixLength,
  );
  const overlapLength = Math.min(
    normalizedOldLine.length,
    prefixLength + suffixLength,
  );
  const maxLength = Math.max(
    normalizedOldLine.length,
    normalizedCandidateLine.length,
  );
  const structuralScore = overlapLength / maxLength;

  if (
    normalizedOldLine.includes(normalizedCandidateLine) ||
    normalizedCandidateLine.includes(normalizedOldLine)
  ) {
    const sharedLength = Math.min(
      normalizedOldLine.length,
      normalizedCandidateLine.length,
    );
    return Math.max(structuralScore, sharedLength / maxLength);
  }

  return structuralScore;
}

function scoreLineWindow(
  oldLines: readonly string[],
  candidateLines: readonly string[],
): number {
  const maxLineCount = Math.max(oldLines.length, candidateLines.length);
  let weightedScore = 0;
  let totalWeight = 0;

  for (let index = 0; index < maxLineCount; index++) {
    const oldLine = oldLines[index] ?? "";
    const candidateLine = candidateLines[index] ?? "";
    const weight = Math.max(
      oldLine.trim().length,
      candidateLine.trim().length,
      1,
    );
    weightedScore += scoreSimilarLine(oldLine, candidateLine) * weight;
    totalWeight += weight;
  }

  return totalWeight === 0 ? 0 : weightedScore / totalWeight;
}

function findClosestEditSnippets(
  oldText: string,
  content: string,
): EditSnippet[] {
  const oldLines = splitDisplayLines(oldText);
  const fileLines = splitDisplayLines(content);
  if (fileLines.length === 0) {
    return [];
  }

  const windowSizes = Array.from(
    new Set([
      Math.max(1, oldLines.length - 1),
      Math.max(1, oldLines.length),
      Math.min(fileLines.length, oldLines.length + 1),
    ]),
  );
  const candidates: (EditSnippet & { score: number })[] = [];

  for (const windowSize of windowSizes) {
    if (windowSize > fileLines.length) {
      continue;
    }

    for (
      let startLineIndex = 0;
      startLineIndex <= fileLines.length - windowSize;
      startLineIndex++
    ) {
      const lines = fileLines.slice(
        startLineIndex,
        startLineIndex + windowSize,
      );
      candidates.push({
        startLine: startLineIndex + 1,
        endLine: startLineIndex + windowSize,
        lines,
        score: scoreLineWindow(oldLines, lines),
      });
    }
  }

  candidates.sort((a, b) => {
    const scoreDelta = b.score - a.score;
    if (scoreDelta !== 0) {
      return scoreDelta;
    }

    const lineSpanDelta =
      Math.abs(a.lines.length - oldLines.length) -
      Math.abs(b.lines.length - oldLines.length);
    if (lineSpanDelta !== 0) {
      return lineSpanDelta;
    }

    return a.startLine - b.startLine;
  });

  const snippets: EditSnippet[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (candidate.score < MIN_EDIT_SIMILARITY_SCORE) {
      break;
    }

    const key = `${candidate.startLine}:${candidate.endLine}`;
    if (seen.has(key)) {
      continue;
    }

    snippets.push({
      startLine: candidate.startLine,
      endLine: candidate.endLine,
      lines: candidate.lines,
    });
    seen.add(key);

    if (snippets.length === MAX_EDIT_ERROR_MATCHES) {
      break;
    }
  }

  return snippets;
}

function buildLineStarts(content: string): number[] {
  const lineStarts = [0];
  for (let index = 0; index < content.length; index++) {
    if (content[index] === "\n") {
      lineStarts.push(index + 1);
    }
  }
  return lineStarts;
}

function findLineNumber(lineStarts: readonly number[], index: number): number {
  let low = 0;
  let high = lineStarts.length - 1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const lineStart = lineStarts[mid];
    if (lineStart === undefined) {
      break;
    }
    if (lineStart <= index) {
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return high + 1;
}

function formatEditNotFoundError(
  path: string,
  oldText: string,
  content: string,
): string {
  const snippets = findClosestEditSnippets(oldText, content);
  if (snippets.length === 0) {
    return `Old text not found in ${path}`;
  }

  return [
    `Old text not found in ${path}`,
    "Closest matches:",
    ...snippets.map(
      (snippet) =>
        `- ${formatLineRange(snippet.startLine, snippet.endLine)}\n${formatSnippetLines(snippet.lines)}`,
    ),
  ].join("\n");
}

function formatEditMultipleMatchesError(
  path: string,
  oldText: string,
  content: string,
  matchIndices: readonly number[],
  totalMatches: number,
): string {
  const lineStarts = buildLineStarts(content);
  const fileLines = splitDisplayLines(content);
  const matchLineCount = countDisplayLines(oldText);
  const snippets = matchIndices.map((matchIndex) => {
    const startLine = findLineNumber(lineStarts, matchIndex);
    const endLine = startLine + matchLineCount - 1;
    return {
      startLine,
      endLine,
      lines: fileLines.slice(startLine - 1, endLine),
    };
  });

  const lines = [
    `Old text matches multiple locations (${totalMatches}) in ${path}`,
    "Matches:",
    ...snippets.map(
      (snippet) =>
        `- ${formatLineRange(snippet.startLine, snippet.endLine)}\n${formatSnippetLines(snippet.lines)}`,
    ),
  ];
  const hiddenMatchCount = totalMatches - matchIndices.length;
  if (hiddenMatchCount > 0) {
    lines.push(`- … ${hiddenMatchCount} more matches`);
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// edit
// ---------------------------------------------------------------------------

const editToolParameters = Type.Object({
  path: Type.String({
    description: "File path (absolute or relative to cwd)",
  }),
  oldText: Type.String({
    description:
      'Exact text to find and replace. Empty string means "create new file".',
  }),
  newText: Type.String({
    description: "Replacement text (or full content for new files)",
  }),
});

/** Arguments for the `edit` tool. */
export type EditArgs = Static<typeof editToolParameters>;

/**
 * Execute an exact-text replacement in a single file.
 *
 * - If `oldText` is empty, creates a new file (with parent directories).
 *   Fails if the file already exists.
 * - Otherwise, reads the file, finds exactly one occurrence of `oldText`,
 *   and replaces it with `newText`. Fails if the text is not found or
 *   matches multiple locations.
 *
 * @param args - Edit arguments (path, oldText, newText).
 * @param cwd - Working directory for resolving relative paths.
 * @returns A {@link ToolExecResult} with confirmation or error message.
 */
export function executeEdit(args: EditArgs, cwd: string): ToolExecResult {
  const filePath = isAbsolute(args.path) ? args.path : join(cwd, args.path);

  // Create new file
  if (args.oldText === "") {
    if (existsSync(filePath)) {
      return textResult(`File already exists: ${args.path}`, true);
    }
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, args.newText, "utf-8");
    return textResult(`Created ${args.path}`, false);
  }

  // Replace in existing file
  if (!existsSync(filePath)) {
    return textResult(`File not found: ${args.path}`, true);
  }

  const content = readFileSync(filePath, "utf-8");

  // Count occurrences
  let count = 0;
  const matchIndices: number[] = [];
  let idx = 0;
  while (true) {
    idx = content.indexOf(args.oldText, idx);
    if (idx === -1) break;
    count++;
    if (matchIndices.length < MAX_EDIT_ERROR_MATCHES) {
      matchIndices.push(idx);
    }
    idx += args.oldText.length;
  }

  if (count === 0) {
    return textResult(
      formatEditNotFoundError(args.path, args.oldText, content),
      true,
    );
  }
  if (count > 1) {
    return textResult(
      formatEditMultipleMatchesError(
        args.path,
        args.oldText,
        content,
        matchIndices,
        count,
      ),
      true,
    );
  }

  // Exactly one match — replace
  const lineEnding = detectLineEnding(content);
  const newText = lineEnding
    ? normalizeLineEndings(args.newText, lineEnding)
    : args.newText;
  const matchIndex = matchIndices[0];
  if (matchIndex === undefined) {
    return textResult(`Old text not found in ${args.path}`, true);
  }
  const updated =
    content.slice(0, matchIndex) +
    newText +
    content.slice(matchIndex + args.oldText.length);
  writeFileSync(filePath, updated, "utf-8");
  return textResult(`Edited ${args.path}`, false);
}

// ---------------------------------------------------------------------------
// readImage
// ---------------------------------------------------------------------------

/** Supported image extensions and their MIME types. */
const IMAGE_MIME_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8]);
const GIF_SIGNATURES = ["GIF87a", "GIF89a"];
const WEBP_RIFF_SIGNATURE = "RIFF";
const WEBP_FILE_SIGNATURE = "WEBP";

interface PngChunk {
  typeBytes: Buffer;
  type: string;
  data: Buffer;
}

interface PngValidationState {
  sawIHDR: boolean;
  sawIDAT: boolean;
  sawIEND: boolean;
  width: number;
  height: number;
  bitDepth: number;
  colorType: number;
  interlaceMethod: number;
  compressedParts: Buffer[];
}

function createPngValidationState(): PngValidationState {
  return {
    sawIHDR: false,
    sawIDAT: false,
    sawIEND: false,
    width: 0,
    height: 0,
    bitDepth: 0,
    colorType: 0,
    interlaceMethod: 0,
    compressedParts: [],
  };
}

function isValidPngColorFormat(bitDepth: number, colorType: number): boolean {
  switch (colorType) {
    case 0:
      return [1, 2, 4, 8, 16].includes(bitDepth);
    case 2:
    case 4:
    case 6:
      return bitDepth === 8 || bitDepth === 16;
    case 3:
      return [1, 2, 4, 8].includes(bitDepth);
    default:
      return false;
  }
}

function getPngScanlineByteLength(
  width: number,
  bitDepth: number,
  colorType: number,
): number {
  const samplesPerPixel =
    colorType === 0 || colorType === 3
      ? 1
      : colorType === 4
        ? 2
        : colorType === 2
          ? 3
          : 4;
  return Math.ceil((width * bitDepth * samplesPerPixel) / 8);
}

function readPngChunk(
  data: Buffer,
  offset: number,
): { chunk: PngChunk; nextOffset: number } | string {
  if (offset + 12 > data.length) {
    return "truncated PNG chunk header";
  }

  const length = data.readUInt32BE(offset);
  const typeBytes = data.subarray(offset + 4, offset + 8);
  const type = typeBytes.toString("ascii");
  const dataOffset = offset + 8;
  const nextOffset = dataOffset + length + 4;

  if (nextOffset > data.length) {
    return `truncated PNG chunk ${type}`;
  }

  const chunkData = data.subarray(dataOffset, dataOffset + length);
  const storedCrc = data.readUInt32BE(dataOffset + length);
  const computedCrc = crc32(Buffer.concat([typeBytes, chunkData]));

  if (storedCrc !== computedCrc) {
    return `invalid PNG CRC for chunk ${type}`;
  }

  return {
    chunk: { typeBytes, type, data: chunkData },
    nextOffset,
  };
}

function validatePngHeaderChunk(
  state: PngValidationState,
  chunk: PngChunk,
): string | null {
  if (state.sawIHDR || state.sawIDAT || chunk.data.length !== 13) {
    return "invalid IHDR chunk";
  }

  const compressionMethod = chunk.data[10] ?? 0;
  const filterMethod = chunk.data[11] ?? 0;
  const interlaceMethod = chunk.data[12] ?? 0;

  state.sawIHDR = true;
  state.width = chunk.data.readUInt32BE(0);
  state.height = chunk.data.readUInt32BE(4);
  state.bitDepth = chunk.data[8] ?? 0;
  state.colorType = chunk.data[9] ?? 0;
  state.interlaceMethod = interlaceMethod;

  if (state.width === 0 || state.height === 0) {
    return "invalid PNG image size";
  }
  if (!isValidPngColorFormat(state.bitDepth, state.colorType)) {
    return "unsupported PNG color format";
  }
  if (compressionMethod !== 0 || filterMethod !== 0) {
    return "unsupported PNG header values";
  }
  if (interlaceMethod !== 0 && interlaceMethod !== 1) {
    return "unsupported PNG interlace method";
  }

  return null;
}

function applyPngChunk(
  state: PngValidationState,
  chunk: PngChunk,
  nextOffset: number,
  totalLength: number,
): string | null {
  if (chunk.type === "IHDR") {
    return validatePngHeaderChunk(state, chunk);
  }

  if (!state.sawIHDR) {
    return "missing IHDR chunk";
  }

  if (chunk.type === "IDAT") {
    if (state.sawIEND) {
      return "invalid PNG chunk order";
    }
    state.sawIDAT = true;
    state.compressedParts.push(chunk.data);
    return null;
  }

  if (chunk.type !== "IEND") {
    return null;
  }

  if (!state.sawIDAT) {
    return "missing IDAT chunk";
  }
  if (chunk.data.length !== 0) {
    return "invalid IEND chunk length";
  }

  state.sawIEND = true;
  if (nextOffset !== totalLength) {
    return "unexpected trailing data after IEND chunk";
  }

  return null;
}

function validateInflatedPngData(state: PngValidationState): string | null {
  try {
    const inflated = inflateSync(Buffer.concat(state.compressedParts));
    if (state.interlaceMethod !== 0) {
      return null;
    }

    const expectedLength =
      state.height *
      (1 +
        getPngScanlineByteLength(state.width, state.bitDepth, state.colorType));
    if (inflated.length !== expectedLength) {
      return "decoded PNG payload does not match image dimensions";
    }
    return null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `corrupt PNG image data: ${message}`;
  }
}

function validatePngImageData(data: Buffer): string | null {
  if (
    data.length < PNG_SIGNATURE.length ||
    !data.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)
  ) {
    return "invalid PNG signature";
  }

  const state = createPngValidationState();
  let offset = PNG_SIGNATURE.length;

  while (offset < data.length) {
    const parsedChunk = readPngChunk(data, offset);
    if (typeof parsedChunk === "string") {
      return parsedChunk;
    }

    const chunkError = applyPngChunk(
      state,
      parsedChunk.chunk,
      parsedChunk.nextOffset,
      data.length,
    );
    if (chunkError) {
      return chunkError;
    }

    offset = parsedChunk.nextOffset;
  }

  if (!state.sawIHDR) {
    return "missing IHDR chunk";
  }
  if (!state.sawIDAT) {
    return "missing IDAT chunk";
  }
  if (!state.sawIEND) {
    return "missing IEND chunk";
  }

  return validateInflatedPngData(state);
}

function validateJpegImageData(data: Buffer): string | null {
  if (
    data.length < 4 ||
    !data.subarray(0, JPEG_SIGNATURE.length).equals(JPEG_SIGNATURE) ||
    data.at(-2) !== 0xff ||
    data.at(-1) !== 0xd9
  ) {
    return "invalid JPEG markers";
  }
  return null;
}

function validateGifImageData(data: Buffer): string | null {
  if (data.length < 14) {
    return "truncated GIF file";
  }

  const header = data.subarray(0, 6).toString("ascii");
  if (!GIF_SIGNATURES.includes(header)) {
    return "invalid GIF signature";
  }
  if (data.at(-1) !== 0x3b) {
    return "missing GIF trailer";
  }
  return null;
}

function validateWebpImageData(data: Buffer): string | null {
  if (data.length < 16) {
    return "truncated WebP file";
  }

  if (
    data.subarray(0, 4).toString("ascii") !== WEBP_RIFF_SIGNATURE ||
    data.subarray(8, 12).toString("ascii") !== WEBP_FILE_SIGNATURE
  ) {
    return "invalid WebP signature";
  }

  const riffSize = data.readUInt32LE(4);
  if (riffSize + 8 > data.length) {
    return "truncated WebP file";
  }

  return null;
}

function validateImageData(mimeType: string, data: Buffer): string | null {
  switch (mimeType) {
    case "image/png":
      return validatePngImageData(data);
    case "image/jpeg":
      return validateJpegImageData(data);
    case "image/gif":
      return validateGifImageData(data);
    case "image/webp":
      return validateWebpImageData(data);
    default:
      return `unsupported image MIME type ${mimeType}`;
  }
}

const readImageToolParameters = Type.Object({
  path: Type.String({
    description: "File path (absolute or relative to cwd)",
  }),
});

/** Arguments for the `readImage` tool. */
export type ReadImageArgs = Static<typeof readImageToolParameters>;

/**
 * Read an image file and return it as base64-encoded content.
 *
 * Supports PNG, JPEG, GIF, and WebP. Returns {@link ImageContent} on
 * success or a text error message on failure. The MIME type is detected
 * from the file extension.
 *
 * @param args - ReadImage arguments (path).
 * @param cwd - Working directory for resolving relative paths.
 * @returns A {@link ToolExecResult} with image content or error message.
 */
export function executeReadImage(
  args: ReadImageArgs,
  cwd: string,
): ToolExecResult {
  const filePath = isAbsolute(args.path) ? args.path : join(cwd, args.path);
  const ext = extname(filePath).toLowerCase();

  const mimeType = IMAGE_MIME_TYPES[ext];
  if (!mimeType) {
    return textResult(
      `Unsupported image format: ${ext || "(no extension)"}`,
      true,
    );
  }

  if (!existsSync(filePath)) {
    return textResult(`File not found: ${args.path}`, true);
  }

  try {
    const data = readFileSync(filePath);
    const validationError = validateImageData(mimeType, data);
    if (validationError) {
      return textResult(
        `Invalid image file ${args.path}: ${validationError}`,
        true,
      );
    }

    return {
      content: [{ type: "image", data: data.toString("base64"), mimeType }],
      isError: false,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return textResult(`Failed to read image ${args.path}: ${message}`, true);
  }
}

// ---------------------------------------------------------------------------
// Tool definitions (pi-ai Tool schemas)
// ---------------------------------------------------------------------------

/** pi-ai tool definition for `edit`. */
export const editTool: Tool<typeof editToolParameters> = {
  name: "edit",
  description:
    "Make an exact-text replacement in a single file. " +
    "Provide the file path, the exact text to find, and the replacement text. " +
    "The old text must match exactly one location in the file. " +
    "To create a new file, use an empty old text and the full file content as new text. " +
    "Use this to write the exact final file content the task requires.",
  parameters: editToolParameters,
};

/**
 * Tool handler that validates edit arguments before execution.
 *
 * @param args - Raw parsed tool-call arguments.
 * @param cwd - Working directory for path resolution.
 * @returns The edit tool result.
 */
export const editToolHandler: ToolHandler = (args, cwd) =>
  executeEdit(validateBuiltinToolArgs(editTool, args), cwd);

/** pi-ai tool definition for `todoWrite`. */
export const todoWriteTool: Tool<typeof todoWriteToolParameters> = {
  name: "todoWrite",
  description:
    "Use this tool to create and manage a structured task list for your current coding session. " +
    "This helps you track progress, organize complex tasks, and keep the user informed. " +
    "Only send the items that changed; unchanged items stay as they are. " +
    "Each item must include `content` and `status`, where `status` is one of `pending`, `in_progress`, `completed`, or `cancelled`. " +
    "Use `cancelled` to remove an item from the list. " +
    "Mark tasks `in_progress` before starting them and `completed` immediately after verification succeeds.",
  parameters: todoWriteToolParameters,
};

/**
 * Create a `todoWrite` handler bound to the current persisted message history.
 *
 * @param messages - Current persisted message history.
 * @returns Tool handler for todo writes.
 */
export function createTodoWriteToolHandler(
  messages: readonly TodoHistoryMessage[],
): ToolHandler {
  return (args) =>
    executeTodoWrite(validateBuiltinToolArgs(todoWriteTool, args), messages);
}

/** pi-ai tool definition for `todoRead`. */
export const todoReadTool: Tool<typeof todoReadToolParameters> = {
  name: "todoRead",
  description:
    "Retrieves the current todo list for this coding session. " +
    "Use this tool before updating todos when you need to inspect the current list, or when the user asks for the current plan or progress. " +
    "If no todos exist yet, it returns an empty list.",
  parameters: todoReadToolParameters,
};

/**
 * Create a `todoRead` handler bound to the current persisted message history.
 *
 * @param messages - Current persisted message history.
 * @returns Tool handler for todo reads.
 */
export function createTodoReadToolHandler(
  messages: readonly TodoHistoryMessage[],
): ToolHandler {
  return (args) => {
    validateBuiltinToolArgs(todoReadTool, args);
    return executeTodoRead(messages);
  };
}

/** pi-ai tool definition for `readImage`. */
export const readImageTool: Tool<typeof readImageToolParameters> = {
  name: "readImage",
  description:
    "Read an image file and return its contents. " +
    "Supports PNG, JPEG, GIF, and WebP formats. " +
    "Use this to inspect screenshots, diagrams, or any image in the repo.",
  parameters: readImageToolParameters,
};

/**
 * Tool handler that validates image-read arguments before execution.
 *
 * @param args - Raw parsed tool-call arguments.
 * @param cwd - Working directory for path resolution.
 * @returns The readImage tool result.
 */
export const readImageToolHandler: ToolHandler = (args, cwd) =>
  executeReadImage(validateBuiltinToolArgs(readImageTool, args), cwd);
