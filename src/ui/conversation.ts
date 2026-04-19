/**
 * Conversation-log rendering for the terminal UI.
 *
 * Renders user, assistant, tool, and UI-only messages into cel-tui nodes.
 * Streaming state is passed in explicitly so the top-level UI module can keep
 * ownership of module-scoped runtime state while this module stays pure.
 *
 * @module
 */

import { homedir } from "node:os";
import {
  basename,
  extname,
  isAbsolute,
  join,
  normalize,
  relative,
} from "node:path";
import { SyntaxHighlight } from "@cel-tui/components";
import { HStack, measureContentHeight, Text, VStack } from "@cel-tui/core";
import type { Node } from "@cel-tui/types";
import type {
  AssistantMessage,
  TextContent,
  ToolResultMessage,
  UserMessage,
} from "@mariozechner/pi-ai";
import type { AppState } from "../index.ts";
import type { UiMessage } from "../session.ts";
import { readBoolean, readFiniteNumber, readString } from "../shared.ts";
import { getSyntaxHighlightTheme, type Theme } from "../theme.ts";
import {
  parseGrepResult,
  parseLegacyShellResult,
  parseReadContinuationHint,
  parseReadResult,
  parseShellResultDetails,
  parseTodoSnapshot,
  type TodoItem,
} from "../tools.ts";
import { APP_NAME, DEV_VERSION_LABEL } from "../version.ts";

/** Single blank-line gap used between conversation-level blocks. */
export const CONVERSATION_GAP = 1;

/** Fixed rendered height for non-verbose tool previews. */
const UI_TOOL_PREVIEW_ROWS = 8;

/** Default width used when preview measurements do not receive one explicitly. */
const DEFAULT_TOOL_PREVIEW_WIDTH = 80;

/** Horizontal columns consumed by tool-block padding and the left border. */
const TOOL_BLOCK_CHROME_WIDTH = 4;

/** A pending tool result shown in the streaming tail. */
export interface PendingToolResult {
  /** Tool call id from the assistant message. */
  toolCallId: string;
  /** Tool name. */
  toolName: string;
  /** Progressive or final tool-result content captured so far. */
  content: ToolResultMessage["content"];
  /** Optional structured details preserved on the tool result. */
  details?: ToolResultMessage["details"];
  /** Whether the tool result was an error. */
  isError: boolean;
}

/** Render options shared by completed and in-progress assistant content. */
interface ConversationRenderOpts {
  /** Whether reasoning blocks are visible. */
  showReasoning: boolean;
  /** Whether tool output should be truncated in the UI. */
  verbose: boolean;
  /** Active UI theme. */
  theme: Theme;
  /** Session working directory used for path display. */
  cwd?: string;
  /** Available terminal width for width-aware tool previews. */
  previewWidth?: number;
}

/** A single streaming assistant tail appended after persisted messages. */
export interface StreamingConversationState {
  /** Whether a response is currently streaming. */
  isStreaming: boolean;
  /** Assistant content accumulated so far. */
  content: AssistantMessage["content"];
  /** Tool results observed during the current streaming turn. */
  pendingToolResults: readonly PendingToolResult[];
}

/** Display-only assistant state used while a response is still streaming. */
interface AssistantRenderState {
  /** Assistant content blocks accumulated so far. */
  content: AssistantMessage["content"];
  /** Optional error text appended below the assistant content. */
  errorMessage?: string;
}

type ConversationMessage = AppState["messages"][number];

type ConversationLogState = Pick<
  AppState,
  "messages" | "showReasoning" | "verbose" | "theme" | "cwd"
> & {
  versionLabel?: AppState["versionLabel"];
};

type ToolCallRenderInfo = {
  name: string;
  args: Record<string, unknown>;
};

interface ToolCallArgsCache {
  messages: readonly ConversationMessage[] | null;
  count: number;
  entries: Map<string, ToolCallRenderInfo>;
}

interface ConversationRenderCache {
  messages: readonly ConversationMessage[] | null;
  startIndex: number;
  count: number;
  showReasoning: boolean;
  verbose: boolean;
  previewWidth: number;
  cwd: string | null;
  theme: Theme | null;
  nodes: Node[];
}

type ToolRenderDirection = "->" | "<-";

type ToolRenderLineKind =
  | "command"
  | "path"
  | "text"
  | "context"
  | "diffAdded"
  | "diffRemoved"
  | "summary"
  | "error";

type SyntaxThemeVariant = "markdown" | "code" | "shell";

interface HighlightedBodySpec {
  /** Full raw source content to syntax-highlight. */
  text: string;
  /** Registered lextide language id. */
  language: string;
  /** Semantic theme variant for this highlighted content. */
  themeVariant: SyntaxThemeVariant;
}

interface ToolBlockSpec {
  /** Tool name shown in the header pill. */
  toolName: string;
  /** Direction shown in the header pill. */
  direction: ToolRenderDirection;
  /** Optional compact text appended after the header pill. */
  headerSuffix?: string;
  /** Logical body lines for the tool block. */
  bodyLines: readonly ToolRenderLine[];
  /** Optional syntax-highlighted body rendered from the full unsplit source. */
  highlightedBody?: HighlightedBodySpec;
  /** Optional custom body node rendered as-is. */
  bodyNode?: Node;
  /** Optional footer lines rendered after the body. */
  footerLines?: readonly ToolRenderLine[];
  /** Whether `/verbose` preview rules apply to the body. */
  previewBody: boolean;
}

/** A single logical line in a rendered tool block. */
export interface ToolRenderLine {
  /** Semantic line kind for styling. */
  kind: ToolRenderLineKind;
  /** Text content for this line. */
  text: string;
}

const EMPTY_STREAMING_CONTENT: AssistantMessage["content"] = [];
const EMPTY_PENDING_TOOL_RESULTS: readonly PendingToolResult[] = [];
const EMPTY_RENDER_NODES: Node[] = [];
const EMPTY_TOOL_RESULT_ARGS: Record<string, unknown> = Object.freeze({});

const toolCallArgsCache: ToolCallArgsCache = {
  messages: null,
  count: 0,
  entries: new Map(),
};

const conversationRenderCache: ConversationRenderCache = {
  messages: null,
  startIndex: 0,
  count: 0,
  showReasoning: false,
  verbose: false,
  previewWidth: DEFAULT_TOOL_PREVIEW_WIDTH,
  cwd: null,
  theme: null,
  nodes: EMPTY_RENDER_NODES,
};

/** Reset cached committed conversation renders. */
export function resetConversationRenderCache(): void {
  toolCallArgsCache.messages = null;
  toolCallArgsCache.count = 0;
  toolCallArgsCache.entries = new Map();
  conversationRenderCache.messages = null;
  conversationRenderCache.startIndex = 0;
  conversationRenderCache.count = 0;
  conversationRenderCache.showReasoning = false;
  conversationRenderCache.verbose = false;
  conversationRenderCache.previewWidth = DEFAULT_TOOL_PREVIEW_WIDTH;
  conversationRenderCache.cwd = null;
  conversationRenderCache.theme = null;
  conversationRenderCache.nodes = EMPTY_RENDER_NODES;
}

/** Render a user message with a subtle background. */
function renderUserMessage(msg: UserMessage, theme: Theme): Node {
  const text =
    typeof msg.content === "string"
      ? msg.content
      : msg.content
          .filter((content): content is TextContent => content.type === "text")
          .map((content) => content.text)
          .join("");

  return VStack({ bgColor: theme.userMsgBg, padding: { x: 1 } }, [
    Text(text, { wrap: "word" }),
  ]);
}

/** Render a syntax-highlighted raw markdown block. */
function renderMarkdownTextBlock(content: string, theme: Theme): Node | null {
  if (content === "") {
    return null;
  }

  const highlighted = getHighlightedBodyNode(
    {
      text: content,
      language: "markdown",
      themeVariant: "markdown",
    },
    theme,
  );
  if (!highlighted) {
    return null;
  }

  return HStack({ padding: { x: 1 } }, [VStack({ flex: 1 }, [highlighted])]);
}

function getAssistantErrorMessage(
  assistant: AssistantMessage | AssistantRenderState,
): string | undefined {
  if ("role" in assistant && assistant.stopReason === "error") {
    return assistant.errorMessage;
  }
  if ("role" in assistant) {
    return undefined;
  }
  return assistant.errorMessage;
}

function renderThinkingBlock(
  thinking: string,
  opts: ConversationRenderOpts,
): Node {
  if (opts.showReasoning) {
    return VStack({ padding: { x: 1 } }, [
      Text(thinking, {
        wrap: "word",
        fgColor: opts.theme.mutedText,
        italic: true,
      }),
    ]);
  }

  const lineCount = thinking.split("\n").length;
  const unit = lineCount === 1 ? "line" : "lines";
  return VStack({ padding: { x: 1 } }, [
    Text(`Thinking... ${lineCount} ${unit}.`, {
      fgColor: opts.theme.mutedText,
      italic: true,
    }),
  ]);
}

function coalesceAdjacentTextBlocks(
  content: AssistantMessage["content"],
): AssistantMessage["content"] {
  const coalesced: AssistantMessage["content"] = [];

  for (const block of content) {
    if (block.type !== "text") {
      coalesced.push(block);
      continue;
    }

    const previous = coalesced.at(-1);
    if (previous?.type === "text") {
      coalesced[coalesced.length - 1] = {
        ...previous,
        text: previous.text + block.text,
      };
      continue;
    }

    coalesced.push({ ...block });
  }

  return coalesced;
}

function renderAssistantContentBlock(
  block: AssistantMessage["content"][number],
  opts: ConversationRenderOpts,
): Node | null {
  if (block.type === "text" && block.text) {
    return renderMarkdownTextBlock(block.text, opts.theme);
  }
  if (block.type === "thinking" && block.thinking) {
    return renderThinkingBlock(block.thinking, opts);
  }
  if (block.type === "toolCall") {
    return renderToolCall(block, opts);
  }
  return null;
}

/**
 * Render a completed or in-progress assistant response.
 *
 * @param assistant - Completed assistant message or in-progress render state.
 * @param opts - Shared conversation render options.
 * @returns The rendered assistant node, or `null` when there is nothing to show.
 */
export function renderAssistantMessage(
  assistant: AssistantMessage | AssistantRenderState,
  opts: ConversationRenderOpts,
): Node | null {
  const children = coalesceAdjacentTextBlocks(assistant.content)
    .map((block) => {
      return renderAssistantContentBlock(block, opts);
    })
    .filter((child): child is Node => child !== null);

  const errorMessage = getAssistantErrorMessage(assistant);
  if (errorMessage) {
    children.push(
      VStack({ padding: { x: 1 } }, [
        Text(`Error: ${errorMessage}`, {
          fgColor: opts.theme.error,
        }),
      ]),
    );
  }

  if (children.length === 0) {
    return null;
  }

  return VStack({ gap: CONVERSATION_GAP }, children);
}

function getPreviewWidth(previewWidth?: number): number {
  if (!Number.isFinite(previewWidth)) {
    return DEFAULT_TOOL_PREVIEW_WIDTH;
  }
  return Math.max(1, Math.floor(previewWidth!));
}

function getToolBodyWidth(previewWidth?: number): number {
  return Math.max(1, getPreviewWidth(previewWidth) - TOOL_BLOCK_CHROME_WIDTH);
}

/** Split multi-line tool text into logical render lines. */
function splitToolTextLines(
  text: string,
  kind: Exclude<ToolRenderLineKind, "summary">,
): ToolRenderLine[] {
  if (text === "") {
    return [];
  }

  const lines = text.split("\n");
  if (lines.at(-1) === "") {
    lines.pop();
  }

  return lines.map((line) => ({ kind, text: line }));
}

function normalizeDisplayLineEndings(text: string): string {
  return text.replace(/\r\n/g, "\n");
}

/** Read a string argument from a tool-call argument map. */
function getToolArgString(args: Record<string, unknown>, key: string): string {
  return readString(args, key) ?? "";
}

const HOME_DIR = homedir();

function resolveToolPath(path: string, cwd?: string): string {
  if (path === "") {
    return "";
  }
  if (!cwd || isAbsolute(path)) {
    return path;
  }
  return join(cwd, path);
}

function abbreviateHomePath(path: string): string {
  if (path === HOME_DIR) {
    return "~";
  }
  if (path.startsWith(`${HOME_DIR}/`)) {
    return `~/${path.slice(HOME_DIR.length + 1)}`;
  }
  return path;
}

function normalizeDisplayPath(path: string): string {
  if (path === "") {
    return path;
  }
  return normalize(path).replace(/\\/g, "/");
}

function formatResolvedToolPath(path: string, cwd?: string): string {
  const resolved = resolveToolPath(path, cwd);
  if (resolved === "") {
    return path;
  }
  return abbreviateHomePath(normalizeDisplayPath(resolved));
}

function formatRelativeToolPath(path: string, cwd?: string): string {
  const resolved = resolveToolPath(path, cwd);
  if (resolved === "" || !cwd || !isAbsolute(resolved)) {
    return normalizeDisplayPath(path);
  }

  const relativePath = relative(cwd, resolved);
  if (relativePath === "") {
    return ".";
  }
  if (relativePath.startsWith("..")) {
    return formatResolvedToolPath(resolved);
  }
  return normalizeDisplayPath(relativePath);
}

function getReadLanguageCandidates(path: string): string[] {
  const fileName = basename(path).toLowerCase();
  const extension = extname(fileName).toLowerCase();

  switch (extension) {
    case ".ts":
      return ["typescript"];
    case ".tsx":
      return ["tsx", "typescript"];
    case ".js":
    case ".mjs":
    case ".cjs":
      return ["javascript"];
    case ".jsx":
      return ["jsx", "javascript"];
    case ".json":
      return ["json"];
    case ".md":
      return ["markdown"];
    case ".yml":
    case ".yaml":
      return ["yaml"];
    case ".toml":
      return ["toml"];
    case ".sh":
    case ".bash":
      return ["bash"];
    case ".css":
      return ["css"];
    case ".html":
    case ".htm":
      return ["html"];
    case ".xml":
      return ["xml"];
    case ".py":
      return ["python"];
    case ".rs":
      return ["rust"];
    case ".go":
      return ["go"];
    case ".java":
      return ["java"];
    case ".c":
      return ["c"];
    case ".h":
      return ["c"];
    case ".cpp":
    case ".cc":
    case ".cxx":
    case ".hpp":
      return ["cpp"];
    default:
      break;
  }

  if (fileName === "dockerfile") {
    return ["dockerfile"];
  }
  if (fileName === "makefile") {
    return ["makefile"];
  }
  if (fileName === "agents.md" || fileName === "readme.md") {
    return ["markdown"];
  }
  return [];
}

function formatTodoWriteCallSummary(args: Record<string, unknown>): string {
  const todoCount = Array.isArray(args.todos) ? args.todos.length : 0;
  const todoLabel = todoCount === 1 ? "todo" : "todos";
  return `Updating todos... ${todoCount} ${todoLabel} updated`;
}

function parseShellToolContent(
  content: ToolResultMessage["content"],
  details?: ToolResultMessage["details"],
) {
  return (
    parseShellResultDetails(details) ??
    parseLegacyShellResult(getToolContentText(content))
  );
}

function buildShellResultLines(
  content: ToolResultMessage["content"],
  details?: ToolResultMessage["details"],
): { bodyLines: ToolRenderLine[]; footerLines?: ToolRenderLine[] } {
  const result = parseShellToolContent(content, details);
  if (!result) {
    return {
      bodyLines: splitToolTextLines(
        normalizeDisplayLineEndings(getToolContentText(content)),
        "text",
      ),
    };
  }

  const bodyLines: ToolRenderLine[] = [];
  const stdout = normalizeDisplayLineEndings(result.stdout);
  const stderr = normalizeDisplayLineEndings(result.stderr);

  if (stdout !== "") {
    bodyLines.push(...splitToolTextLines(stdout, "text"));
  }
  if (stderr !== "") {
    if (bodyLines.length > 0) {
      bodyLines.push({ kind: "text", text: "" });
    }
    bodyLines.push(...splitToolTextLines(stderr, "text"));
  }
  if (bodyLines.length === 0) {
    bodyLines.push({ kind: "summary", text: "(no output)" });
  }

  return {
    bodyLines,
    footerLines: [
      {
        kind: "text",
        text: `exit ${result.exitCode}`,
      },
    ],
  };
}

function getToolHeaderName(toolName: string): string {
  return toolName.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
}

function getToolHeaderColor(toolName: string, theme: Theme) {
  switch (toolName) {
    case "shell":
    case "read":
    case "grep":
    case "readImage":
    case "todoWrite":
    case "todoRead":
      return theme.accentText;
    case "edit":
      return theme.secondaryAccentText;
    default:
      return theme.secondaryAccentText ?? theme.toolText;
  }
}

function getHighlightedBodyNode(
  spec: HighlightedBodySpec,
  theme: Theme,
): Node | null {
  if (spec.text === "") {
    return null;
  }

  try {
    return SyntaxHighlight(spec.text, spec.language, {
      theme: getSyntaxHighlightTheme(theme, spec.themeVariant),
    });
  } catch {
    return null;
  }
}

/** Render a single styled text node for a tool line. */
function renderToolLine(line: ToolRenderLine, theme: Theme): Node {
  switch (line.kind) {
    case "command":
    case "path":
      return Text(line.text, {
        fgColor: theme.accentText,
        bold: true,
        wrap: "word",
      });
    case "diffAdded":
      return Text(line.text, { fgColor: theme.diffAdded, wrap: "word" });
    case "diffRemoved":
      return Text(line.text, { fgColor: theme.diffRemoved, wrap: "word" });
    case "context":
      return Text(line.text, {
        fgColor: theme.mutedText,
        wrap: "word",
      });
    case "summary":
      return Text(line.text, {
        fgColor: theme.toolText,
        italic: true,
        wrap: "word",
      });
    case "error":
      return Text(line.text, { fgColor: theme.error, wrap: "word" });
    case "text":
      return Text(line.text, {
        fgColor: theme.toolText,
        wrap: "word",
      });
  }
}

/** Render styled text nodes for tool lines. */
function renderToolLines(
  lines: readonly ToolRenderLine[],
  theme: Theme,
): Node[] {
  return lines.map((line) => renderToolLine(line, theme));
}

function getTodoMarker(todo: TodoItem): "[ ]" | "[~]" | "[x]" {
  switch (todo.status) {
    case "in_progress":
      return "[~]";
    case "completed":
      return "[x]";
    default:
      return "[ ]";
  }
}

function getTodoColor(todo: TodoItem, theme: Theme): Theme["toolText"] {
  switch (todo.status) {
    case "in_progress":
      return theme.accentText;
    case "completed":
      return theme.diffAdded;
    default:
      return theme.toolText;
  }
}

function renderTodoChecklist(todos: readonly TodoItem[], theme: Theme): Node {
  if (todos.length === 0) {
    return Text("No todo items.", {
      fgColor: theme.mutedText,
      italic: true,
      wrap: "word",
    });
  }

  return VStack(
    {},
    todos.map((todo) =>
      Text(`${getTodoMarker(todo)} ${todo.content}`, {
        fgColor: getTodoColor(todo, theme),
        wrap: "word",
      }),
    ),
  );
}

function measureToolNodesHeight(lines: readonly Node[], width: number): number {
  if (lines.length === 0) {
    return 0;
  }

  return measureContentHeight(VStack({}, [...lines]), { width });
}

function measureToolNodeHeight(line: Node, width: number): number {
  return measureContentHeight(VStack({}, [line]), { width });
}

function countVisibleTailNodes(
  lines: readonly Node[],
  width: number,
  maxRows: number,
): number {
  let remainingRows = maxRows;
  let visibleLineCount = 0;

  for (let index = lines.length - 1; index >= 0; index--) {
    const lineHeight = measureToolNodeHeight(lines[index]!, width);
    if (lineHeight > remainingRows) {
      return visibleLineCount > 0 ? visibleLineCount : 1;
    }
    remainingRows -= lineHeight;
    visibleLineCount += 1;
  }

  return visibleLineCount;
}

function renderToolHeaderPill(
  toolName: string,
  direction: ToolRenderDirection,
  theme: Theme,
): Node {
  return HStack({ bgColor: theme.toolBorder, padding: { x: 1 } }, [
    Text(`${getToolHeaderName(toolName)} ${direction}`, {
      fgColor: getToolHeaderColor(toolName, theme),
      bold: true,
    }),
  ]);
}

function renderToolHeaderRow(spec: ToolBlockSpec, theme: Theme): Node {
  const children: Node[] = [
    renderToolHeaderPill(spec.toolName, spec.direction, theme),
  ];

  if (spec.headerSuffix) {
    children.push(
      Text(` ${spec.headerSuffix}`, {
        fgColor: theme.toolText,
        wrap: "word",
      }),
    );
  }

  return HStack({}, children);
}

function renderToolBodyFromNodes(
  lines: readonly Node[],
  previewBody: boolean,
  opts: Pick<ConversationRenderOpts, "previewWidth" | "theme" | "verbose">,
): { body: Node | null; summary?: ToolRenderLine } {
  if (lines.length === 0) {
    return { body: null };
  }

  if (opts.verbose || !previewBody) {
    return { body: VStack({}, [...lines]) };
  }

  const bodyWidth = getToolBodyWidth(opts.previewWidth);
  const totalHeight = measureToolNodesHeight(lines, bodyWidth);
  if (totalHeight <= UI_TOOL_PREVIEW_ROWS) {
    return { body: VStack({}, [...lines]) };
  }

  const visibleLineCount = countVisibleTailNodes(
    lines,
    bodyWidth,
    UI_TOOL_PREVIEW_ROWS,
  );
  const previewLines = lines.slice(-visibleLineCount);
  const hiddenLineCount = Math.max(0, lines.length - visibleLineCount);

  return {
    body: VStack(
      {
        height: UI_TOOL_PREVIEW_ROWS,
        justifyContent: "end",
      },
      [...previewLines],
    ),
    summary:
      hiddenLineCount > 0
        ? {
            kind: "summary",
            text: `And ${hiddenLineCount} lines more`,
          }
        : undefined,
  };
}

function renderToolBodyFromHighlightedNode(
  highlighted: Node,
  previewBody: boolean,
  opts: Pick<ConversationRenderOpts, "previewWidth" | "theme" | "verbose">,
): { body: Node | null; summary?: ToolRenderLine } {
  if (opts.verbose || !previewBody) {
    return { body: highlighted };
  }

  const bodyWidth = getToolBodyWidth(opts.previewWidth);
  const totalHeight = measureToolNodeHeight(highlighted, bodyWidth);
  if (totalHeight <= UI_TOOL_PREVIEW_ROWS || highlighted.type !== "vstack") {
    return { body: highlighted };
  }

  const visibleLineCount = countVisibleTailNodes(
    highlighted.children,
    bodyWidth,
    UI_TOOL_PREVIEW_ROWS,
  );
  const previewLines = highlighted.children.slice(-visibleLineCount);
  const hiddenLineCount = Math.max(
    0,
    highlighted.children.length - visibleLineCount,
  );

  return {
    body: VStack(
      {
        height: UI_TOOL_PREVIEW_ROWS,
        justifyContent: "end",
      },
      [...previewLines],
    ),
    summary:
      hiddenLineCount > 0
        ? {
            kind: "summary",
            text: `And ${hiddenLineCount} lines more`,
          }
        : undefined,
  };
}

function renderToolBody(
  spec: ToolBlockSpec,
  opts: Pick<ConversationRenderOpts, "previewWidth" | "theme" | "verbose">,
): { body: Node | null; summary?: ToolRenderLine } {
  if (spec.bodyNode) {
    return { body: spec.bodyNode };
  }

  if (spec.highlightedBody) {
    const highlighted = getHighlightedBodyNode(
      spec.highlightedBody,
      opts.theme,
    );
    if (highlighted) {
      return renderToolBodyFromHighlightedNode(
        highlighted,
        spec.previewBody,
        opts,
      );
    }
  }

  return renderToolBodyFromNodes(
    renderToolLines(spec.bodyLines, opts.theme),
    spec.previewBody,
    opts,
  );
}

/** Render a tool block with a left border and compact header pill. */
function renderToolBlock(
  spec: ToolBlockSpec,
  opts: Pick<ConversationRenderOpts, "previewWidth" | "theme" | "verbose">,
): Node {
  const body = renderToolBody(spec, opts);
  const children: Node[] = [renderToolHeaderRow(spec, opts.theme)];

  if (body.body) {
    children.push(body.body);
  }
  if (body.summary) {
    children.push(renderToolLine(body.summary, opts.theme));
  }
  if (spec.footerLines) {
    children.push(...renderToolLines(spec.footerLines, opts.theme));
  }

  return HStack({ padding: { x: 1 } }, [
    Text("│ ", { fgColor: opts.theme.toolBorder }),
    VStack({ flex: 1 }, children),
  ]);
}

function getToolTextBlocks(content: ToolResultMessage["content"]): string[] {
  return content
    .filter((entry): entry is TextContent => entry.type === "text")
    .map((entry) => entry.text);
}

function getToolContentText(content: ToolResultMessage["content"]): string {
  return getToolTextBlocks(content).join("\n");
}

function parseReadToolContent(
  content: ToolResultMessage["content"],
): ReturnType<typeof parseReadResult> {
  const textBlocks = getToolTextBlocks(content);
  if (textBlocks.length > 1) {
    const continuation = parseReadContinuationHint(textBlocks.at(-1) ?? "");
    if (continuation) {
      return {
        body: textBlocks.slice(0, -1).join("\n"),
        continuation,
      };
    }
  }

  return parseReadResult(textBlocks.join("\n"));
}

function buildShellToolCallSpec(args: Record<string, unknown>): ToolBlockSpec {
  const command = getToolArgString(args, "command");
  return {
    toolName: "shell",
    direction: "->",
    bodyLines: splitToolTextLines(command, "command"),
    highlightedBody:
      command === ""
        ? undefined
        : {
            text: command,
            language: "bash",
            themeVariant: "shell",
          },
    previewBody: true,
  };
}

function buildReadToolCallSpec(args: Record<string, unknown>): ToolBlockSpec {
  const lines: ToolRenderLine[] = [];
  const filePath = getToolArgString(args, "path");
  const offset = readFiniteNumber(args, "offset");
  const limit = readFiniteNumber(args, "limit");

  if (filePath) {
    lines.push({ kind: "path", text: filePath });
  }
  if (offset !== null) {
    lines.push({ kind: "text", text: `offset: ${offset}` });
  }
  if (limit !== null) {
    lines.push({ kind: "text", text: `limit: ${limit}` });
  }

  return {
    toolName: "read",
    direction: "->",
    bodyLines: lines,
    previewBody: true,
  };
}

function buildGrepToolCallSpec(args: Record<string, unknown>): ToolBlockSpec {
  const lines: ToolRenderLine[] = [];
  const pattern = getToolArgString(args, "pattern");
  const path = getToolArgString(args, "path");
  const glob = getToolArgString(args, "glob");
  const context = readFiniteNumber(args, "context");
  const limit = readFiniteNumber(args, "limit");
  const ignoreCase = readBoolean(args, "ignoreCase");
  const literal = readBoolean(args, "literal");

  if (pattern) {
    lines.push({ kind: "command", text: pattern });
  }
  if (path) {
    lines.push({ kind: "text", text: `path: ${path}` });
  }
  if (glob) {
    lines.push({ kind: "text", text: `glob: ${glob}` });
  }
  if (ignoreCase) {
    lines.push({ kind: "text", text: "ignoreCase: true" });
  }
  if (literal) {
    lines.push({ kind: "text", text: "literal: true" });
  }
  if (context !== null) {
    lines.push({ kind: "text", text: `context: ${context}` });
  }
  if (limit !== null) {
    lines.push({ kind: "text", text: `limit: ${limit}` });
  }

  return {
    toolName: "grep",
    direction: "->",
    bodyLines: lines,
    previewBody: true,
  };
}

function buildEditToolCallSpec(args: Record<string, unknown>): ToolBlockSpec {
  const lines: ToolRenderLine[] = [];
  const filePath = getToolArgString(args, "path");
  if (filePath) {
    lines.push({ kind: "path", text: filePath });
  }
  lines.push(
    ...splitToolTextLines(getToolArgString(args, "oldText"), "diffRemoved"),
  );
  lines.push(
    ...splitToolTextLines(getToolArgString(args, "newText"), "diffAdded"),
  );

  return {
    toolName: "edit",
    direction: "->",
    bodyLines: lines,
    previewBody: true,
  };
}

function buildTodoWriteToolCallSpec(
  args: Record<string, unknown>,
): ToolBlockSpec {
  return {
    toolName: "todoWrite",
    direction: "->",
    bodyLines: [{ kind: "text", text: formatTodoWriteCallSummary(args) }],
    previewBody: false,
  };
}

function buildReadImageToolCallSpec(
  args: Record<string, unknown>,
): ToolBlockSpec {
  const filePath = getToolArgString(args, "path");
  return {
    toolName: "readImage",
    direction: "->",
    bodyLines: filePath ? [{ kind: "path", text: filePath }] : [],
    previewBody: false,
  };
}

function isMcpToolName(toolName: string): boolean {
  return toolName.includes("__");
}

function buildGenericToolCallSpec(
  toolName: string,
  args: Record<string, unknown>,
): ToolBlockSpec {
  const text = JSON.stringify(args, null, 2);
  return {
    toolName,
    direction: "->",
    bodyLines: text && text !== "{}" ? splitToolTextLines(text, "text") : [],
    previewBody: isMcpToolName(toolName),
  };
}

function buildToolCallSpec(
  toolName: string,
  args: Record<string, unknown>,
): ToolBlockSpec {
  if (toolName === "shell") {
    return buildShellToolCallSpec(args);
  }
  if (toolName === "read") {
    return buildReadToolCallSpec(args);
  }
  if (toolName === "grep") {
    return buildGrepToolCallSpec(args);
  }
  if (toolName === "edit") {
    return buildEditToolCallSpec(args);
  }
  if (toolName === "todoWrite") {
    return buildTodoWriteToolCallSpec(args);
  }
  if (toolName === "readImage") {
    return buildReadImageToolCallSpec(args);
  }
  return buildGenericToolCallSpec(toolName, args);
}

function renderToolCall(
  toolCall: Extract<AssistantMessage["content"][number], { type: "toolCall" }>,
  opts: Pick<ConversationRenderOpts, "previewWidth" | "verbose" | "theme">,
): Node {
  return renderToolBlock(
    buildToolCallSpec(toolCall.name, toolCall.arguments),
    opts,
  );
}

function buildShellToolResultSpec(
  content: ToolResultMessage["content"],
  details?: ToolResultMessage["details"],
): ToolBlockSpec {
  const shellResult = buildShellResultLines(content, details);
  return {
    toolName: "shell",
    direction: "<-",
    bodyLines: shellResult.bodyLines,
    ...(shellResult.footerLines
      ? { footerLines: shellResult.footerLines }
      : {}),
    previewBody: true,
  };
}

function buildReadToolResultSpec(
  args: Record<string, unknown>,
  content: ToolResultMessage["content"],
  isError: boolean,
  cwd?: string,
): ToolBlockSpec {
  const filePath = getToolArgString(args, "path");
  const resolvedPath = formatResolvedToolPath(filePath, cwd);
  const resultText = getToolContentText(content);

  if (isError) {
    return {
      toolName: "read",
      direction: "<-",
      ...(resolvedPath ? { headerSuffix: resolvedPath } : {}),
      bodyLines: splitToolTextLines(
        normalizeDisplayLineEndings(resultText),
        "error",
      ),
      previewBody: true,
    };
  }

  const parsed = parseReadToolContent(content);
  const bodyText = parsed.body;
  const displayBodyText = normalizeDisplayLineEndings(bodyText);
  const language = getReadLanguageCandidates(resolveToolPath(filePath, cwd))[0];
  return {
    toolName: "read",
    direction: "<-",
    ...(resolvedPath ? { headerSuffix: resolvedPath } : {}),
    bodyLines:
      displayBodyText === ""
        ? [{ kind: "summary", text: "Empty file." }]
        : splitToolTextLines(displayBodyText, "text"),
    ...(bodyText !== "" && language
      ? {
          highlightedBody: {
            text: bodyText,
            language,
            themeVariant: "code" as const,
          },
        }
      : {}),
    previewBody: true,
  };
}

function buildGrepToolResultSpec(
  content: ToolResultMessage["content"],
  isError: boolean,
  cwd?: string,
): ToolBlockSpec {
  const resultText = getToolContentText(content);
  if (isError) {
    return {
      toolName: "grep",
      direction: "<-",
      bodyLines: splitToolTextLines(resultText, "error"),
      previewBody: true,
    };
  }

  const result = parseGrepResult(resultText);
  if (!result) {
    return {
      toolName: "grep",
      direction: "<-",
      bodyLines: splitToolTextLines(resultText, "text"),
      previewBody: true,
    };
  }

  const lines: ToolRenderLine[] = [];
  for (const file of result.files) {
    lines.push({
      kind: "path",
      text: formatRelativeToolPath(file.path, cwd),
    });
    for (const line of file.lines) {
      const text = line.text.replace(/\r?\n$/, "");
      lines.push({
        kind: line.kind === "context" ? "context" : "text",
        text: `  ${line.lineNumber}: ${text}`,
      });
    }
  }

  if (lines.length === 0) {
    lines.push({ kind: "summary", text: "No matches found." });
  }

  return {
    toolName: "grep",
    direction: "<-",
    bodyLines: lines,
    ...(result.hint
      ? { footerLines: [{ kind: "summary", text: result.hint }] }
      : {}),
    previewBody: true,
  };
}

function buildEditToolResultSpec(
  args: Record<string, unknown>,
  isError: boolean,
  resultText: string,
): ToolBlockSpec {
  if (isError) {
    return {
      toolName: "edit",
      direction: "<-",
      bodyLines: splitToolTextLines(resultText, "error"),
      previewBody: true,
    };
  }

  const filePath = getToolArgString(args, "path");
  return {
    toolName: "edit",
    direction: "<-",
    bodyLines: filePath ? [{ kind: "path", text: `~ ${filePath}` }] : [],
    previewBody: false,
  };
}

function buildTodoToolResultSpec(
  toolName: string,
  content: ToolResultMessage["content"],
  isError: boolean,
  theme: Theme,
): ToolBlockSpec {
  if (isError) {
    return {
      toolName,
      direction: "<-",
      bodyLines: splitToolTextLines(getToolContentText(content), "error"),
      previewBody: false,
    };
  }

  const todos = parseTodoSnapshot(getToolContentText(content)) ?? [];
  return {
    toolName,
    direction: "<-",
    bodyLines: [],
    bodyNode: renderTodoChecklist(todos, theme),
    previewBody: false,
  };
}

function buildReadImageToolResultSpec(
  args: Record<string, unknown>,
  content: ToolResultMessage["content"],
  isError: boolean,
): ToolBlockSpec {
  if (isError) {
    return {
      toolName: "readImage",
      direction: "<-",
      bodyLines: splitToolTextLines(getToolContentText(content), "error"),
      previewBody: false,
    };
  }

  const filePath = getToolArgString(args, "path");
  return {
    toolName: "readImage",
    direction: "<-",
    bodyLines: filePath ? [{ kind: "path", text: filePath }] : [],
    previewBody: false,
  };
}

function buildGenericToolResultSpec(
  toolName: string,
  output: string,
  isError: boolean,
): ToolBlockSpec {
  return {
    toolName,
    direction: "<-",
    bodyLines: splitToolTextLines(output, isError ? "error" : "text"),
    previewBody: isMcpToolName(toolName),
  };
}

function renderToolResultContent(
  toolName: string,
  args: Record<string, unknown>,
  content: ToolResultMessage["content"],
  isError: boolean,
  opts: Pick<
    ConversationRenderOpts,
    "previewWidth" | "verbose" | "theme" | "cwd"
  >,
  details?: ToolResultMessage["details"],
): Node {
  if (toolName === "shell") {
    return renderToolBlock(buildShellToolResultSpec(content, details), opts);
  }
  if (toolName === "read") {
    return renderToolBlock(
      buildReadToolResultSpec(args, content, isError, opts.cwd),
      opts,
    );
  }
  if (toolName === "grep") {
    return renderToolBlock(
      buildGrepToolResultSpec(content, isError, opts.cwd),
      opts,
    );
  }
  if (toolName === "edit") {
    return renderToolBlock(
      buildEditToolResultSpec(args, isError, getToolContentText(content)),
      opts,
    );
  }
  if (toolName === "todoWrite" || toolName === "todoRead") {
    return renderToolBlock(
      buildTodoToolResultSpec(toolName, content, isError, opts.theme),
      opts,
    );
  }
  if (toolName === "readImage") {
    return renderToolBlock(
      buildReadImageToolResultSpec(args, content, isError),
      opts,
    );
  }

  return renderToolBlock(
    buildGenericToolResultSpec(toolName, getToolContentText(content), isError),
    opts,
  );
}

/**
 * Render a tool result, dispatching by tool name.
 *
 * @param toolName - Tool name to render.
 * @param args - Tool call arguments used for compact result rendering.
 * @param resultText - Text content from the tool result message.
 * @param isError - Whether the tool execution failed.
 * @param opts - Shared conversation render options.
 * @param details - Optional structured tool-result details.
 * @returns The rendered tool block node.
 */
export function renderToolResult(
  toolName: string,
  args: Record<string, unknown>,
  resultText: string,
  isError: boolean,
  opts: ConversationRenderOpts,
  details?: ToolResultMessage["details"],
): Node {
  const content: ToolResultMessage["content"] = resultText
    ? [{ type: "text", text: resultText }]
    : [];

  return renderToolResultContent(
    toolName,
    args,
    content,
    isError,
    opts,
    details,
  );
}

function renderUiTodoMessage(
  msg: Extract<UiMessage, { kind: "todo" }>,
  theme: Theme,
): Node {
  return VStack({ padding: { x: 1 } }, [
    Text("todo", {
      fgColor: theme.secondaryAccentText ?? theme.toolText,
      bold: true,
      wrap: "word",
    }),
    renderTodoChecklist(msg.todos, theme),
  ]);
}

/** Render an internal UI message in the conversation log. */
function renderUiMessage(
  msg: UiMessage,
  opts: Pick<ConversationRenderOpts, "previewWidth" | "theme">,
): Node {
  if (msg.kind === "todo") {
    return renderUiTodoMessage(msg, opts.theme);
  }

  if (msg.format === "markdown") {
    const markdown = renderMarkdownTextBlock(msg.content, opts.theme);
    if (markdown) {
      return markdown;
    }
  }

  return VStack({ padding: { x: 1 } }, [
    Text(msg.content, {
      fgColor: opts.theme.mutedText,
      italic: true,
      wrap: "word",
    }),
  ]);
}

function renderEmptyConversationBanner(
  theme: Theme,
  versionLabel: string,
): Node {
  return HStack({ justifyContent: "center" }, [
    VStack({ padding: { x: 1 } }, [
      Text(APP_NAME, {
        bold: true,
        fgColor: theme.accentText,
      }),
      Text(versionLabel, {
        fgColor: theme.mutedText,
      }),
    ]),
  ]);
}

function pushConversationNode(nodes: Node[], node: Node | null): void {
  if (!node) {
    return;
  }
  nodes.push(node);
}

function rememberToolCallArgs(
  message: AssistantMessage,
  toolCallArgs: Map<string, ToolCallRenderInfo>,
): void {
  for (const block of message.content) {
    if (block.type !== "toolCall") {
      continue;
    }
    toolCallArgs.set(block.id, {
      name: block.name,
      args: block.arguments,
    });
  }
}

function renderToolResultMessage(
  toolName: string,
  args: Record<string, unknown>,
  content: ToolResultMessage["content"],
  isError: boolean,
  renderOpts: ConversationRenderOpts,
  details?: ToolResultMessage["details"],
): Node {
  return renderToolResultContent(
    toolName,
    args,
    content,
    isError,
    renderOpts,
    details,
  );
}

function renderConversationMessage(
  message: ConversationMessage,
  renderOpts: ConversationRenderOpts,
  toolCallArgs: Map<string, ToolCallRenderInfo>,
  theme: Theme,
): Node | null {
  if (message.role === "ui") {
    return renderUiMessage(message, renderOpts);
  }
  if (message.role === "user") {
    return renderUserMessage(message, theme);
  }
  if (message.role === "assistant") {
    rememberToolCallArgs(message, toolCallArgs);
    return renderAssistantMessage(message, renderOpts);
  }

  const info = toolCallArgs.get(message.toolCallId);
  return renderToolResultMessage(
    info?.name ?? message.toolName,
    info?.args ?? EMPTY_TOOL_RESULT_ARGS,
    message.content,
    message.isError,
    renderOpts,
    message.details,
  );
}

function cacheToolCallArgs(messages: readonly ConversationMessage[]): void {
  if (
    toolCallArgsCache.messages !== messages ||
    toolCallArgsCache.count > messages.length
  ) {
    toolCallArgsCache.messages = messages;
    toolCallArgsCache.count = 0;
    toolCallArgsCache.entries = new Map();
  }

  for (let index = toolCallArgsCache.count; index < messages.length; index++) {
    const message = messages[index];
    if (message?.role === "assistant") {
      rememberToolCallArgs(message, toolCallArgsCache.entries);
    }
  }

  toolCallArgsCache.count = messages.length;
}

function canReuseCommittedConversationCache(
  state: ConversationLogState,
  startIndex: number,
  previewWidth: number,
): boolean {
  return (
    conversationRenderCache.messages === state.messages &&
    conversationRenderCache.startIndex === startIndex &&
    conversationRenderCache.showReasoning === state.showReasoning &&
    conversationRenderCache.verbose === state.verbose &&
    conversationRenderCache.previewWidth === previewWidth &&
    conversationRenderCache.cwd === state.cwd &&
    conversationRenderCache.theme === state.theme &&
    conversationRenderCache.count <= state.messages.length
  );
}

function cacheCommittedConversation(
  state: ConversationLogState,
  renderOpts: ConversationRenderOpts,
  startIndex: number,
): void {
  const previewWidth = getPreviewWidth(renderOpts.previewWidth);
  cacheToolCallArgs(state.messages);

  if (!canReuseCommittedConversationCache(state, startIndex, previewWidth)) {
    conversationRenderCache.messages = state.messages;
    conversationRenderCache.startIndex = startIndex;
    conversationRenderCache.count = startIndex;
    conversationRenderCache.showReasoning = state.showReasoning;
    conversationRenderCache.verbose = state.verbose;
    conversationRenderCache.previewWidth = previewWidth;
    conversationRenderCache.cwd = state.cwd;
    conversationRenderCache.theme = state.theme;
    conversationRenderCache.nodes = [];
  }

  for (
    let index = conversationRenderCache.count;
    index < state.messages.length;
    index++
  ) {
    pushConversationNode(
      conversationRenderCache.nodes,
      renderConversationMessage(
        state.messages[index]!,
        renderOpts,
        toolCallArgsCache.entries,
        state.theme,
      ),
    );
  }

  conversationRenderCache.count = state.messages.length;
}

function hasStreamingTail(streaming: StreamingConversationState): boolean {
  return (
    (streaming.content !== EMPTY_STREAMING_CONTENT ||
      streaming.pendingToolResults !== EMPTY_PENDING_TOOL_RESULTS) &&
    (streaming.content.length > 0 || streaming.pendingToolResults.length > 0)
  );
}

/**
 * Build the full conversation log as an array of nodes.
 *
 * @param state - Conversation rendering state.
 * @param streaming - Current in-progress assistant tail, if any.
 * @param startIndex - Index of the first committed message to render.
 * @param previewWidth - Available terminal width for width-aware tool previews.
 * @returns The rendered conversation log nodes.
 */
export function buildConversationLogNodes(
  state: ConversationLogState,
  streaming: StreamingConversationState,
  startIndex = 0,
  previewWidth = DEFAULT_TOOL_PREVIEW_WIDTH,
): Node[] {
  const renderOpts: ConversationRenderOpts = {
    showReasoning: state.showReasoning,
    verbose: state.verbose,
    theme: state.theme,
    cwd: state.cwd,
    previewWidth,
  };

  if (state.messages.length === 0 && !hasStreamingTail(streaming)) {
    return [
      renderEmptyConversationBanner(
        state.theme,
        state.versionLabel ?? DEV_VERSION_LABEL,
      ),
    ];
  }

  cacheCommittedConversation(state, renderOpts, startIndex);

  if (!hasStreamingTail(streaming)) {
    return conversationRenderCache.nodes;
  }

  const nodes = [...conversationRenderCache.nodes];
  pushConversationNode(
    nodes,
    renderAssistantMessage(
      {
        content: streaming.content,
      },
      renderOpts,
    ),
  );

  for (const pendingToolResult of streaming.pendingToolResults) {
    const info = toolCallArgsCache.entries.get(pendingToolResult.toolCallId);
    pushConversationNode(
      nodes,
      renderToolResultMessage(
        info?.name ?? pendingToolResult.toolName,
        info?.args ?? EMPTY_TOOL_RESULT_ARGS,
        pendingToolResult.content,
        pendingToolResult.isError,
        renderOpts,
        pendingToolResult.details,
      ),
    );
  }

  return nodes;
}
