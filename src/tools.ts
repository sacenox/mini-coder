/**
 * Built-in tool implementations: `edit`, `shell`, and `readImage`.
 *
 * Each tool is exposed as a pure-ish execute function that takes typed
 * arguments and a working directory, returning a result object. The pi-ai
 * {@link Tool} definitions (TypeBox schemas) are exported separately for
 * registration with the agent context.
 *
 * @module
 */

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, isAbsolute, join } from "node:path";
import type { ImageContent, TextContent, Tool } from "@mariozechner/pi-ai";
import { Type } from "@mariozechner/pi-ai";
import type { ToolUpdateCallback } from "./agent.ts";

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

/**
 * Result from executing a tool.
 *
 * Content blocks carry either text or image data. The agent loop
 * maps these directly into {@link ToolResultMessage.content}.
 */
export interface ToolExecResult {
  /** Content blocks for the tool result (text and/or images). */
  content: (TextContent | ImageContent)[];
  /** Whether the execution encountered an error. */
  isError: boolean;
}

/** Convenience: build a text-only {@link ToolExecResult}. */
function textResult(text: string, isError: boolean): ToolExecResult {
  return { content: [{ type: "text", text }], isError };
}

function detectLineEnding(content: string): "\n" | "\r\n" | null {
  if (content.includes("\r\n")) {
    return "\r\n";
  }
  if (content.includes("\n")) {
    return "\n";
  }
  return null;
}

function normalizeLineEndings(
  content: string,
  lineEnding: "\n" | "\r\n",
): string {
  if (lineEnding === "\r\n") {
    return content.replace(/\r?\n/g, "\r\n");
  }
  return content.replace(/\r\n/g, "\n");
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

/** Arguments for the `edit` tool. */
interface EditArgs {
  /** File path (absolute or relative to cwd). */
  path: string;
  /** Exact text to find. Empty string means "create new file". */
  oldText: string;
  /** Replacement text (or full content for new files). */
  newText: string;
}

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
// shell
// ---------------------------------------------------------------------------

/** Arguments for the `shell` tool. */
interface ShellArgs {
  /** The command to run. */
  command: string;
}

/** Options for shell execution. */
interface ShellOpts {
  /** Maximum output lines before truncation. Default: 1000. */
  maxLines?: number;
  /** Maximum UTF-8 bytes before truncation. Default: 50_000. */
  maxBytes?: number;
  /** Abort signal to cancel the command. */
  signal?: AbortSignal;
  /** Callback for progressive output updates while the command is running. */
  onUpdate?: ToolUpdateCallback;
}

type ShellProcess = ReturnType<typeof Bun.spawn>;

const DEFAULT_MAX_LINES = 1000;
const DEFAULT_MAX_BYTES = 50_000;
const SHELL_UPDATE_INTERVAL_MS = 75;

/** Format combined stdout/stderr for display in tool results. */
function formatShellOutput(stdout: string, stderr: string): string {
  if (stdout && stderr) {
    return `${stdout}\n\n[stderr]\n${stderr}`;
  }
  if (stdout) {
    return stdout;
  }
  if (stderr) {
    return `[stderr]\n${stderr}`;
  }
  return "";
}

interface ShellCommandLines {
  lines: string[];
  lineEnding: "\n" | "\r\n";
  hasTrailingLineEnding: boolean;
}

interface PendingHeredoc {
  startLineIndex: number;
  delimiter: string;
  stripLeadingTabs: boolean;
}

interface ShellQuoteState {
  quote: "'" | '"' | null;
  escaped: boolean;
}

function splitShellCommandLines(command: string): ShellCommandLines {
  const lineEnding = detectLineEnding(command) ?? "\n";
  const normalized = normalizeLineEndings(command, "\n");
  const hasTrailingLineEnding = normalized.endsWith("\n");
  const lines = normalized.split("\n");
  if (hasTrailingLineEnding) {
    lines.pop();
  }
  return { lines, lineEnding, hasTrailingLineEnding };
}

function joinShellCommandLines(parts: ShellCommandLines): string {
  const joined = parts.lines.join(parts.lineEnding);
  if (parts.hasTrailingLineEnding) {
    return joined + parts.lineEnding;
  }
  return joined;
}

function advanceShellQuoteState(char: string, state: ShellQuoteState): boolean {
  if (state.quote === "'") {
    if (char === "'") {
      state.quote = null;
    }
    return true;
  }

  if (state.quote === '"') {
    if (state.escaped) {
      state.escaped = false;
      return true;
    }
    if (char === "\\") {
      state.escaped = true;
      return true;
    }
    if (char === '"') {
      state.quote = null;
    }
    return true;
  }

  if (char === "'") {
    state.quote = "'";
    return true;
  }
  if (char === '"') {
    state.quote = '"';
    return true;
  }

  return false;
}

function isHeredocPrefixCharacter(char: string): boolean {
  return (
    char === "" ||
    char === " " ||
    char === "\t" ||
    char === ";" ||
    char === "(" ||
    char === "&" ||
    char === "|"
  );
}

function getHeredocStartAt(
  line: string,
  index: number,
): { index: number; stripLeadingTabs: boolean } | null {
  if (line[index] !== "<" || line[index + 1] !== "<") {
    return null;
  }

  const previousChar = index === 0 ? "" : (line[index - 1] ?? "");
  if (!isHeredocPrefixCharacter(previousChar)) {
    return null;
  }

  return {
    index,
    stripLeadingTabs: line[index + 2] === "-",
  };
}

function findUnquotedHeredocStart(
  line: string,
): { index: number; stripLeadingTabs: boolean } | null {
  const quoteState: ShellQuoteState = { quote: null, escaped: false };
  let heredocStart: { index: number; stripLeadingTabs: boolean } | null = null;

  for (let index = 0; index < line.length - 1; index++) {
    const char = line[index];
    if (char === undefined || advanceShellQuoteState(char, quoteState)) {
      continue;
    }

    const nextHeredocStart = getHeredocStartAt(line, index);
    if (!nextHeredocStart) {
      continue;
    }
    if (heredocStart) {
      return null;
    }

    heredocStart = nextHeredocStart;
    index += heredocStart.stripLeadingTabs ? 2 : 1;
  }

  return heredocStart;
}

function skipHeredocDelimiterWhitespace(line: string, cursor: number): number {
  let nextCursor = cursor;
  while (line[nextCursor] === " " || line[nextCursor] === "\t") {
    nextCursor++;
  }
  return nextCursor;
}

function readQuotedHeredocDelimiter(
  line: string,
  cursor: number,
): string | null {
  const quote = line[cursor];
  if (quote !== "'" && quote !== '"') {
    return null;
  }

  const endQuoteIndex = line.indexOf(quote, cursor + 1);
  if (endQuoteIndex === -1) {
    return null;
  }
  return line.slice(cursor + 1, endQuoteIndex);
}

function isHeredocDelimiterStopCharacter(char: string): boolean {
  return (
    char === " " ||
    char === "\t" ||
    char === "<" ||
    char === ">" ||
    char === "&" ||
    char === "|" ||
    char === ";" ||
    char === "(" ||
    char === ")"
  );
}

function readBareHeredocDelimiter(line: string, cursor: number): string | null {
  const startChar = line[cursor];
  if (startChar === undefined || !/[A-Za-z_]/.test(startChar)) {
    return null;
  }

  let endIndex = cursor;
  while (endIndex < line.length) {
    const currentChar = line[endIndex];
    if (
      currentChar === undefined ||
      isHeredocDelimiterStopCharacter(currentChar)
    ) {
      break;
    }
    endIndex++;
  }
  return line.slice(cursor, endIndex);
}

function findUnquotedHeredoc(
  line: string,
  startLineIndex: number,
): PendingHeredoc | null {
  const heredocStart = findUnquotedHeredocStart(line);
  if (!heredocStart) {
    return null;
  }

  const cursor = skipHeredocDelimiterWhitespace(
    line,
    heredocStart.index + 2 + (heredocStart.stripLeadingTabs ? 1 : 0),
  );
  const delimiter =
    readQuotedHeredocDelimiter(line, cursor) ??
    readBareHeredocDelimiter(line, cursor);
  if (!delimiter) {
    return null;
  }

  return {
    startLineIndex,
    delimiter,
    stripLeadingTabs: heredocStart.stripLeadingTabs,
  };
}

function getHeredocLineBody(line: string, stripLeadingTabs: boolean): string {
  if (!stripLeadingTabs) {
    return line;
  }
  return line.replace(/^\t+/, "");
}

function getSupportedHeredocTrailer(rest: string): string | null {
  const trimmedRest = rest.trimStart();
  if (!trimmedRest) {
    return null;
  }
  if (trimmedRest.startsWith("&&")) {
    return trimmedRest.slice(2).trim() ? rest : null;
  }
  if (trimmedRest.startsWith("||")) {
    return null;
  }
  if (trimmedRest.startsWith("|")) {
    return trimmedRest.slice(1).trim() ? rest : null;
  }
  if (trimmedRest.startsWith(">")) {
    return trimmedRest.slice(1).trim() ? rest : null;
  }
  return null;
}

function rewritePendingHeredocTrailer(
  parts: ShellCommandLines,
  line: string,
  lineIndex: number,
  pendingHeredoc: PendingHeredoc,
): PendingHeredoc | null {
  const body = getHeredocLineBody(line, pendingHeredoc.stripLeadingTabs);
  if (body === pendingHeredoc.delimiter) {
    return null;
  }
  if (!body.startsWith(pendingHeredoc.delimiter)) {
    return pendingHeredoc;
  }

  const trailer = getSupportedHeredocTrailer(
    body.slice(pendingHeredoc.delimiter.length),
  );
  if (!trailer) {
    return pendingHeredoc;
  }

  const startLine = parts.lines[pendingHeredoc.startLineIndex];
  if (startLine === undefined) {
    return pendingHeredoc;
  }

  parts.lines[pendingHeredoc.startLineIndex] = startLine + trailer;
  const leadingTabs = pendingHeredoc.stripLeadingTabs
    ? (line.match(/^\t*/) ?? [""])[0]
    : "";
  parts.lines[lineIndex] = `${leadingTabs}${pendingHeredoc.delimiter}`;
  return null;
}

function normalizeHeredocTrailingContinuations(command: string): string {
  const parts = splitShellCommandLines(command);
  let pendingHeredoc: PendingHeredoc | null = null;

  for (const [index, line] of parts.lines.entries()) {
    if (pendingHeredoc) {
      pendingHeredoc = rewritePendingHeredocTrailer(
        parts,
        line,
        index,
        pendingHeredoc,
      );
      continue;
    }

    pendingHeredoc = findUnquotedHeredoc(line, index);
  }

  return joinShellCommandLines(parts);
}

function normalizeLeadingDashPrintf(command: string): string {
  const parts = splitShellCommandLines(command);
  let pendingHeredoc: PendingHeredoc | null = null;

  for (const [index, line] of parts.lines.entries()) {
    if (pendingHeredoc) {
      const body = getHeredocLineBody(line, pendingHeredoc.stripLeadingTabs);
      if (body === pendingHeredoc.delimiter) {
        pendingHeredoc = null;
      }
      continue;
    }

    parts.lines[index] = line.replace(
      /^(\s*)printf(\s+)(['"])-/,
      "$1printf$2-- $3-",
    );
    pendingHeredoc = findUnquotedHeredoc(parts.lines[index] || "", index);
  }

  return joinShellCommandLines(parts);
}

function normalizeShellCommand(command: string): string {
  try {
    return normalizeLeadingDashPrintf(
      normalizeHeredocTrailingContinuations(command),
    );
  } catch {
    return command;
  }
}

interface ShellCaptureFiles {
  stdoutPath: string;
  stderrPath: string;
  cleanup: () => void;
}

function createShellCaptureFiles(): ShellCaptureFiles {
  const dir = mkdtempSync(join(tmpdir(), "mini-coder-shell-"));
  return {
    stdoutPath: join(dir, "stdout.log"),
    stderrPath: join(dir, "stderr.log"),
    cleanup: () => {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // Best-effort cleanup. Background processes may still hold the files open.
      }
    },
  };
}

function readShellCapture(path: string): string {
  try {
    return readFileSync(path, "utf-8");
  } catch {
    return "";
  }
}

function readShellCaptureOutput(
  capture: Pick<ShellCaptureFiles, "stdoutPath" | "stderrPath">,
): { stdout: string; stderr: string } {
  return {
    stdout: readShellCapture(capture.stdoutPath),
    stderr: readShellCapture(capture.stderrPath),
  };
}

function buildShellSpawnOptions(
  cwd: string,
  capture: Pick<ShellCaptureFiles, "stdoutPath" | "stderrPath">,
): Parameters<typeof Bun.spawn>[1] {
  return {
    cwd,
    stdout: Bun.file(capture.stdoutPath),
    stderr: Bun.file(capture.stderrPath),
    ...(process.platform === "win32" ? {} : { detached: true }),
  };
}

function abortShellProcess(proc: ShellProcess): void {
  if (proc.killed || proc.exitCode !== null) {
    return;
  }

  if (process.platform !== "win32") {
    try {
      process.kill(-proc.pid, "SIGTERM");
      return;
    } catch {
      // Fall through to a direct kill when the process group is unavailable.
    }
  }

  proc.kill("SIGTERM");
}

function registerShellAbort(
  signal: AbortSignal | undefined,
  proc: ShellProcess,
): (() => void) | null {
  if (!signal) {
    return null;
  }

  const abortListener = (): void => {
    abortShellProcess(proc);
  };

  if (signal.aborted) {
    abortShellProcess(proc);
    return null;
  }

  signal.addEventListener("abort", abortListener, { once: true });
  return () => {
    signal.removeEventListener("abort", abortListener);
  };
}

/**
 * Run a command in the user's shell.
 *
 * Executes via `$SHELL -c` (falling back to `/bin/sh`). Returns combined
 * stdout/stderr and the exit code. Large output is truncated to keep
 * head + tail lines with a middle marker.
 *
 * @param args - Shell arguments (command).
 * @param cwd - Working directory to run the command in.
 * @param opts - Optional execution options (maxLines, signal, onUpdate).
 * @returns A {@link ToolExecResult} with the command output.
 */
export async function executeShell(
  args: ShellArgs,
  cwd: string,
  opts?: ShellOpts,
): Promise<ToolExecResult> {
  const shell = process.env.SHELL || "/bin/sh";
  const maxLines = opts?.maxLines ?? DEFAULT_MAX_LINES;
  const maxBytes = opts?.maxBytes ?? DEFAULT_MAX_BYTES;
  const capture = createShellCaptureFiles();
  let updateTimer: ReturnType<typeof setInterval> | null = null;
  let cleanupAbort: (() => void) | null = null;
  let lastReportedOutput = "";

  try {
    const buildOutput = (trimEnd: boolean): string => {
      const { stdout, stderr } = readShellCaptureOutput(capture);
      return truncateOutput(
        formatShellOutput(
          trimEnd ? stdout.trimEnd() : stdout,
          trimEnd ? stderr.trimEnd() : stderr,
        ),
        maxLines,
        maxBytes,
      );
    };

    const emitUpdate = (): void => {
      if (!opts?.onUpdate) {
        return;
      }

      const output = buildOutput(false);
      if (!output || output === lastReportedOutput) {
        return;
      }

      lastReportedOutput = output;
      opts.onUpdate(textResult(output, false));
    };

    const command = normalizeShellCommand(args.command);
    const proc = Bun.spawn(
      [shell, "-c", command],
      buildShellSpawnOptions(cwd, capture),
    );
    cleanupAbort = registerShellAbort(opts?.signal, proc);

    if (opts?.onUpdate) {
      updateTimer = setInterval(emitUpdate, SHELL_UPDATE_INTERVAL_MS);
    }

    const exitCode = await proc.exited;

    if (updateTimer) {
      clearInterval(updateTimer);
      updateTimer = null;
    }
    cleanupAbort?.();

    const output = buildOutput(true);
    if (opts?.onUpdate && output && output !== lastReportedOutput) {
      opts.onUpdate(textResult(output, false));
    }

    const isError = exitCode !== 0;
    const body = output || "(no output)";
    return textResult(`Exit code: ${exitCode}\n${body}`, isError);
  } catch (err) {
    cleanupAbort?.();
    if (updateTimer) {
      clearInterval(updateTimer);
      updateTimer = null;
    }
    const message = err instanceof Error ? err.message : String(err);
    return textResult(`Shell error: ${message}`, true);
  } finally {
    capture.cleanup();
  }
}

// ---------------------------------------------------------------------------
// Output truncation
// ---------------------------------------------------------------------------

/** Build line-limited head/tail segments and their truncation marker. */
function buildLineTruncation(
  output: string,
  maxLines: number,
): {
  head: string;
  tail: string;
  marker: string;
} | null {
  const lines = output.split("\n");
  if (lines.length <= maxLines) {
    return null;
  }

  const headCount = Math.ceil(maxLines / 2);
  const tailCount = Math.floor(maxLines / 2);
  const omitted = lines.length - headCount - tailCount;

  return {
    head: lines.slice(0, headCount).join("\n"),
    tail: lines.slice(lines.length - tailCount).join("\n"),
    marker: `\n… truncated ${omitted} lines …\n`,
  };
}

function isHighSurrogate(codeUnit: number): boolean {
  return codeUnit >= 0xd800 && codeUnit <= 0xdbff;
}

function isLowSurrogate(codeUnit: number): boolean {
  return codeUnit >= 0xdc00 && codeUnit <= 0xdfff;
}

function findUtf8SliceLength(
  input: string,
  maxBytes: number,
  getCandidate: (length: number) => string,
): number {
  if (maxBytes <= 0 || input === "") {
    return 0;
  }

  let low = 0;
  let high = input.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    const candidate = getCandidate(mid);
    if (Buffer.byteLength(candidate, "utf8") <= maxBytes) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }

  return low;
}

function normalizeUtf8PrefixEnd(input: string, end: number): number {
  if (end <= 0 || end >= input.length) {
    return end;
  }

  const previousCodeUnit = input.charCodeAt(end - 1);
  const nextCodeUnit = input.charCodeAt(end);
  if (isHighSurrogate(previousCodeUnit) && isLowSurrogate(nextCodeUnit)) {
    return end - 1;
  }

  return end;
}

function normalizeUtf8SuffixStart(input: string, start: number): number {
  if (start <= 0 || start >= input.length) {
    return start;
  }

  const previousCodeUnit = input.charCodeAt(start - 1);
  const nextCodeUnit = input.charCodeAt(start);
  if (isHighSurrogate(previousCodeUnit) && isLowSurrogate(nextCodeUnit)) {
    return start + 1;
  }

  return start;
}

/** Slice the largest UTF-8 prefix that fits within `maxBytes`. */
function sliceUtf8Prefix(input: string, maxBytes: number): string {
  const end = normalizeUtf8PrefixEnd(
    input,
    findUtf8SliceLength(input, maxBytes, (length) => input.slice(0, length)),
  );
  return input.slice(0, end);
}

/** Slice the largest UTF-8 suffix that fits within `maxBytes`. */
function sliceUtf8Suffix(input: string, maxBytes: number): string {
  const start = normalizeUtf8SuffixStart(
    input,
    input.length -
      findUtf8SliceLength(input, maxBytes, (length) =>
        input.slice(input.length - length),
      ),
  );
  return input.slice(start);
}

/** Fit disjoint head/tail segments plus a marker within a UTF-8 byte budget. */
function fitSegmentsWithinBytes(
  headSource: string,
  tailSource: string,
  marker: string,
  maxBytes: number,
): string {
  const markerBytes = Buffer.byteLength(marker, "utf8");
  if (markerBytes >= maxBytes) {
    return sliceUtf8Prefix(headSource, maxBytes);
  }

  const availableBytes = maxBytes - markerBytes;
  const headBudget = Math.ceil(availableBytes / 2);
  const tailBudget = Math.floor(availableBytes / 2);

  let head = sliceUtf8Prefix(headSource, headBudget);
  let tail = sliceUtf8Suffix(tailSource, tailBudget);

  const usedBytes =
    Buffer.byteLength(head, "utf8") + Buffer.byteLength(tail, "utf8");
  let remainingBytes = availableBytes - usedBytes;

  if (remainingBytes > 0) {
    const headBytes = Buffer.byteLength(head, "utf8");
    const expandedHead = sliceUtf8Prefix(
      headSource,
      headBytes + remainingBytes,
    );
    remainingBytes -= Buffer.byteLength(expandedHead, "utf8") - headBytes;
    head = expandedHead;
  }

  if (remainingBytes > 0) {
    const tailBytes = Buffer.byteLength(tail, "utf8");
    tail = sliceUtf8Suffix(tailSource, tailBytes + remainingBytes);
  }

  return head + marker + tail;
}

/** Truncate output by UTF-8 byte size, preserving head and tail text. */
function truncateOutputByBytes(output: string, maxBytes: number): string {
  if (Buffer.byteLength(output, "utf8") <= maxBytes) {
    return output;
  }

  return fitSegmentsWithinBytes(
    output,
    output,
    "\n… truncated for size …\n",
    maxBytes,
  );
}

/**
 * Truncate output to keep useful head and tail content within line and byte budgets.
 *
 * The line budget avoids flooding the model with very tall outputs, while the
 * byte budget prevents context explosions caused by a small number of very long
 * lines.
 *
 * @param output - The full output string.
 * @param maxLines - Maximum number of content lines to keep.
 * @param maxBytes - Maximum UTF-8 bytes to keep.
 * @returns The (possibly truncated) output string.
 */
export function truncateOutput(
  output: string,
  maxLines: number,
  maxBytes: number,
): string {
  if (!output) return output;

  const lineTruncation = buildLineTruncation(output, maxLines);
  if (!lineTruncation) {
    return truncateOutputByBytes(output, maxBytes);
  }

  const lineLimited =
    lineTruncation.head + lineTruncation.marker + lineTruncation.tail;
  if (Buffer.byteLength(lineLimited, "utf8") <= maxBytes) {
    return lineLimited;
  }

  return fitSegmentsWithinBytes(
    lineTruncation.head,
    lineTruncation.tail,
    lineTruncation.marker,
    maxBytes,
  );
}

// ---------------------------------------------------------------------------
// Tool definitions (pi-ai Tool schemas)
// ---------------------------------------------------------------------------

/** pi-ai tool definition for `edit`. */
export const editTool: Tool = {
  name: "edit",
  description:
    "Make an exact-text replacement in a single file. " +
    "Provide the file path, the exact text to find, and the replacement text. " +
    "The old text must match exactly one location in the file. " +
    "To create a new file, use an empty old text and the full file content as new text. " +
    "Use this to write the exact final file content the task requires.",
  parameters: Type.Object({
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
  }),
};

/** pi-ai tool definition for `shell`. */
export const shellTool: Tool = {
  name: "shell",
  description:
    "Run a command in the user's shell. Returns stdout, stderr, and exit code. " +
    "Use this to explore the codebase, read tests/verifiers/examples, inspect required outputs, and run targeted checks, builds, or git commands.",
  parameters: Type.Object({
    command: Type.String({ description: "The shell command to execute" }),
  }),
};

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

/** Arguments for the `readImage` tool. */
interface ReadImageArgs {
  /** File path (absolute or relative to cwd). */
  path: string;
}

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
    const base64 = Buffer.from(data).toString("base64");

    return {
      content: [{ type: "image", data: base64, mimeType }],
      isError: false,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return textResult(`Failed to read image ${args.path}: ${message}`, true);
  }
}

/** pi-ai tool definition for `readImage`. */
export const readImageTool: Tool = {
  name: "readImage",
  description:
    "Read an image file and return its contents. " +
    "Supports PNG, JPEG, GIF, and WebP formats. " +
    "Use this to inspect screenshots, diagrams, or any image in the repo.",
  parameters: Type.Object({
    path: Type.String({
      description: "File path (absolute or relative to cwd)",
    }),
  }),
};
