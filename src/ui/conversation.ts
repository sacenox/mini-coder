/**
 * Conversation-log rendering for the terminal UI.
 *
 * Renders user, assistant, tool, and UI-only messages into cel-tui nodes.
 * Streaming state is passed in explicitly so the top-level UI module can keep
 * ownership of module-scoped runtime state while this module stays pure.
 *
 * @module
 */

import {
  SyntaxHighlight,
  type SyntaxHighlightTheme,
} from "@cel-tui/components";
import { HStack, measureContentHeight, Text, VStack } from "@cel-tui/core";
import type { Color, Node } from "@cel-tui/types";
import type {
  AssistantMessage,
  TextContent,
  ToolResultMessage,
  UserMessage,
} from "@mariozechner/pi-ai";
import type { AppState } from "../index.ts";
import type { UiMessage } from "../session.ts";
import type { Theme } from "../theme.ts";
import { parseTodoSnapshot, type TodoItem } from "../tools.ts";
import { APP_NAME, DEV_VERSION_LABEL } from "../version.ts";

/** Single blank-line gap used between conversation-level blocks. */
export const CONVERSATION_GAP = 1;

/** Fixed rendered height for non-verbose tool previews. */
const UI_TOOL_PREVIEW_ROWS = 8;

/** Default width used when preview measurements do not receive one explicitly. */
const DEFAULT_TOOL_PREVIEW_WIDTH = 80;

/** Horizontal columns consumed by assistant-markdown padding. */
const MARKDOWN_BLOCK_CHROME_WIDTH = 2;

/** Horizontal columns consumed by tool-block padding and the left border. */
const TOOL_BLOCK_CHROME_WIDTH = 4;

/** ANSI16 fallback hex values for syntax-highlighter theme overrides. */
const ANSI_COLOR_HEX: Readonly<Record<Color, string>> = {
  color00: "#000000",
  color01: "#cd3131",
  color02: "#0dbc79",
  color03: "#e5e510",
  color04: "#2472c8",
  color05: "#bc3fbc",
  color06: "#11a8cd",
  color07: "#e5e5e5",
  color08: "#666666",
  color09: "#f14c4c",
  color10: "#23d18b",
  color11: "#f5f543",
  color12: "#3b8eea",
  color13: "#d670d6",
  color14: "#29b8db",
  color15: "#ffffff",
};

/** A pending tool result shown in the streaming tail. */
export interface PendingToolResult {
  /** Tool call id from the assistant message. */
  toolCallId: string;
  /** Tool name. */
  toolName: string;
  /** Progressive or final tool-result content captured so far. */
  content: ToolResultMessage["content"];
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
  "messages" | "showReasoning" | "verbose" | "theme"
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
  theme: Theme | null;
  nodes: Node[];
}

type ToolRenderDirection = "->" | "<-";

type ToolRenderLineKind =
  | "command"
  | "path"
  | "text"
  | "diffAdded"
  | "diffRemoved"
  | "summary"
  | "error";

type SyntaxThemeVariant = "markdown" | "shell";

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
  /** Logical body lines for the tool block. */
  bodyLines: readonly ToolRenderLine[];
  /** Optional syntax-highlighted body rendered from the full unsplit source. */
  highlightedBody?: HighlightedBodySpec;
  /** Optional custom body node rendered as-is. */
  bodyNode?: Node;
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
function renderMarkdownTextBlock(
  content: string,
  theme: Theme,
  previewWidth?: number,
): Node | null {
  if (content === "") {
    return null;
  }

  const children = getHighlightedBodyLines(
    {
      text: content,
      language: "markdown",
      themeVariant: "markdown",
    },
    theme,
    getMarkdownBodyWidth(previewWidth),
  );
  if (children.length === 0) {
    return null;
  }

  return HStack({ padding: { x: 1 } }, [VStack({ flex: 1 }, children)]);
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
    return renderMarkdownTextBlock(block.text, opts.theme, opts.previewWidth);
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

function getMarkdownBodyWidth(previewWidth?: number): number {
  return Math.max(
    1,
    getPreviewWidth(previewWidth) - MARKDOWN_BLOCK_CHROME_WIDTH,
  );
}

function getToolBodyWidth(previewWidth?: number): number {
  return Math.max(1, getPreviewWidth(previewWidth) - TOOL_BLOCK_CHROME_WIDTH);
}

function getHighlightWrapChunkSize(bodyWidth: number): number {
  return Math.max(1, Math.min(HIGHLIGHT_WRAP_MAX_CHUNK_GRAPHEMES, bodyWidth));
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

/** Read a string argument from a tool-call argument map. */
function getToolArgString(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  return typeof value === "string" ? value : "";
}

function formatTodoWriteCallSummary(args: Record<string, unknown>): string {
  const todoCount = Array.isArray(args.todos) ? args.todos.length : 0;
  const todoLabel = todoCount === 1 ? "todo" : "todos";
  return `Updating todos... ${todoCount} ${todoLabel} updated`;
}

/** Strip shell execution labels and normalize the exit line for the UI. */
function normalizeShellOutput(output: string): string {
  return output
    .replace(/^Exit code: (\d+)(?:\n|$)/, (_, code: string) => `exit ${code}\n`)
    .replace(/(^|\n)\[stderr\]\n/g, "$1")
    .replace(/\n$/, "");
}

function getToolHeaderName(toolName: string): string {
  return toolName.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
}

function getToolHeaderColor(toolName: string, theme: Theme) {
  switch (toolName) {
    case "shell":
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

type SyntaxThemeRegistration = Exclude<SyntaxHighlightTheme, string>;
type SyntaxThemeTokenColor = NonNullable<
  SyntaxThemeRegistration["tokenColors"]
>[number];

const graphemeSegmenter = new Intl.Segmenter(undefined, {
  granularity: "grapheme",
});
const HIGHLIGHT_WRAP_MAX_CHUNK_GRAPHEMES = 32;
const syntaxThemeCache: Record<
  SyntaxThemeVariant,
  WeakMap<Theme, SyntaxThemeRegistration>
> = {
  markdown: new WeakMap(),
  shell: new WeakMap(),
};

function colorToHex(color: Color | undefined): string | undefined {
  return color ? ANSI_COLOR_HEX[color] : undefined;
}

function pushSyntaxTokenColor(
  tokenColors: SyntaxThemeTokenColor[],
  scope: string | readonly string[],
  foreground: Color | undefined,
  fontStyle?: string,
): void {
  const foregroundHex = colorToHex(foreground);
  if (!foregroundHex && !fontStyle) {
    return;
  }

  tokenColors.push({
    scope,
    settings: {
      ...(foregroundHex ? { foreground: foregroundHex } : {}),
      ...(fontStyle ? { fontStyle } : {}),
    },
  });
}

function pushShellSyntaxTokenColors(
  tokenColors: SyntaxThemeTokenColor[],
  theme: Theme,
): void {
  pushSyntaxTokenColor(tokenColors, "comment", theme.mutedText);
  pushSyntaxTokenColor(
    tokenColors,
    ["keyword", "storage"],
    theme.secondaryAccentText,
  );
  pushSyntaxTokenColor(
    tokenColors,
    [
      "entity.name.function",
      "function",
      "meta.function-call",
      "support.function",
      "title",
    ],
    theme.accentText,
  );
  pushSyntaxTokenColor(
    tokenColors,
    [
      "built_in",
      "class",
      "entity.name.type",
      "entity.other.inherited-class",
      "support.class",
      "support.type",
      "type",
    ],
    theme.accentText,
  );
  pushSyntaxTokenColor(
    tokenColors,
    ["constant.language", "constant.numeric", "literal", "symbol"],
    theme.secondaryAccentText ?? theme.accentText,
  );
  pushSyntaxTokenColor(
    tokenColors,
    ["markup.inline", "string"],
    theme.diffAdded,
  );
  pushSyntaxTokenColor(tokenColors, "regexp", theme.diffRemoved);
  pushSyntaxTokenColor(
    tokenColors,
    ["attr", "attribute", "entity.other.attribute-name", "property"],
    theme.accentText,
  );
  pushSyntaxTokenColor(
    tokenColors,
    ["entity.name.tag", "name", "tag"],
    theme.accentText,
  );
}

function pushMarkdownSyntaxTokenColors(
  tokenColors: SyntaxThemeTokenColor[],
  theme: Theme,
): void {
  pushSyntaxTokenColor(tokenColors, "quote", theme.mutedText, "italic");
  pushSyntaxTokenColor(tokenColors, "section", theme.accentText, "bold");
  pushSyntaxTokenColor(
    tokenColors,
    "bullet",
    theme.secondaryAccentText,
    "bold",
  );
  pushSyntaxTokenColor(tokenColors, ["code", "string"], theme.diffAdded);
  pushSyntaxTokenColor(tokenColors, "link", theme.accentText, "underline");
  pushSyntaxTokenColor(tokenColors, "strong", undefined, "bold");
  pushSyntaxTokenColor(tokenColors, "emphasis", undefined, "italic");
}

function getSyntaxTheme(
  theme: Theme,
  variant: SyntaxThemeVariant,
): SyntaxThemeRegistration {
  const cache = syntaxThemeCache[variant];
  const cached = cache.get(theme);
  if (cached) {
    return cached;
  }

  const tokenColors: SyntaxThemeTokenColor[] = [];
  if (variant === "shell") {
    pushShellSyntaxTokenColors(tokenColors, theme);
  } else {
    pushMarkdownSyntaxTokenColors(tokenColors, theme);
  }

  const syntaxTheme: SyntaxThemeRegistration = {
    tokenColors,
  };
  cache.set(theme, syntaxTheme);
  return syntaxTheme;
}

function splitHighlightedTextNode(
  node: Extract<Node, { type: "text" }>,
  chunkSize: number,
): Node[] {
  if (node.content === "") {
    return [Text("", node.props)];
  }

  const parts = node.content.match(/\s+|\S+/gu);
  if (!parts) {
    return [Text(node.content, node.props)];
  }

  const children: Node[] = [];
  for (const part of parts) {
    if (/^\s+$/u.test(part)) {
      children.push(Text(part, node.props));
      continue;
    }

    let chunk = "";
    let chunkGraphemes = 0;
    for (const { segment } of graphemeSegmenter.segment(part)) {
      chunk += segment;
      chunkGraphemes += 1;

      if (chunkGraphemes === chunkSize) {
        children.push(Text(chunk, node.props));
        chunk = "";
        chunkGraphemes = 0;
      }
    }

    if (chunk !== "") {
      children.push(Text(chunk, node.props));
    }
  }

  return children;
}

function normalizeHighlightedLine(line: Node, bodyWidth: number): Node {
  if (line.type !== "hstack") {
    return line;
  }

  const chunkSize = getHighlightWrapChunkSize(bodyWidth);
  const children = line.children.flatMap((child) => {
    return child.type === "text"
      ? splitHighlightedTextNode(child, chunkSize)
      : [child];
  });
  return HStack(line.props, children);
}

function getHighlightedBodyLines(
  spec: HighlightedBodySpec,
  theme: Theme,
  bodyWidth: number,
): Node[] {
  if (spec.text === "") {
    return [];
  }

  const highlighted = SyntaxHighlight(spec.text, spec.language, {
    theme: getSyntaxTheme(theme, spec.themeVariant),
  });
  return highlighted.children.map((line) =>
    normalizeHighlightedLine(line, bodyWidth),
  );
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
    case "summary":
      return Text(line.text, {
        fgColor: theme.toolText,
        italic: true,
        wrap: "word",
      });
    case "error":
      return Text(line.text, { fgColor: theme.error, wrap: "word" });
    case "text":
      return Text(line.text, { wrap: "word" });
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

function renderToolBody(
  spec: ToolBlockSpec,
  opts: Pick<ConversationRenderOpts, "previewWidth" | "theme" | "verbose">,
): { body: Node | null; summary?: ToolRenderLine } {
  if (spec.bodyNode) {
    return { body: spec.bodyNode };
  }

  if (spec.highlightedBody) {
    return renderToolBodyFromNodes(
      getHighlightedBodyLines(
        spec.highlightedBody,
        opts.theme,
        getToolBodyWidth(opts.previewWidth),
      ),
      spec.previewBody,
      opts,
    );
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
  const children: Node[] = [
    HStack({}, [
      renderToolHeaderPill(spec.toolName, spec.direction, opts.theme),
    ]),
  ];

  if (body.body) {
    children.push(body.body);
  }
  if (body.summary) {
    children.push(renderToolLine(body.summary, opts.theme));
  }

  return HStack({ padding: { x: 1 } }, [
    Text("│ ", { fgColor: opts.theme.toolBorder }),
    VStack({ flex: 1, fgColor: opts.theme.toolText }, children),
  ]);
}

function getToolContentText(content: ToolResultMessage["content"]): string {
  return content
    .filter((entry): entry is TextContent => entry.type === "text")
    .map((entry) => entry.text)
    .join("\n");
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

function buildGenericToolCallSpec(
  toolName: string,
  args: Record<string, unknown>,
): ToolBlockSpec {
  const text = JSON.stringify(args, null, 2);
  return {
    toolName,
    direction: "->",
    bodyLines: text && text !== "{}" ? splitToolTextLines(text, "text") : [],
    previewBody: false,
  };
}

function buildToolCallSpec(
  toolName: string,
  args: Record<string, unknown>,
): ToolBlockSpec {
  if (toolName === "shell") {
    return buildShellToolCallSpec(args);
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
): ToolBlockSpec {
  return {
    toolName: "shell",
    direction: "<-",
    bodyLines: splitToolTextLines(
      normalizeShellOutput(getToolContentText(content)),
      "text",
    ),
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
    previewBody: false,
  };
}

function renderToolResultContent(
  toolName: string,
  args: Record<string, unknown>,
  content: ToolResultMessage["content"],
  isError: boolean,
  opts: Pick<ConversationRenderOpts, "previewWidth" | "verbose" | "theme">,
): Node {
  if (toolName === "shell") {
    return renderToolBlock(buildShellToolResultSpec(content), opts);
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
 * @returns The rendered tool block node.
 */
export function renderToolResult(
  toolName: string,
  args: Record<string, unknown>,
  resultText: string,
  isError: boolean,
  opts: ConversationRenderOpts,
): Node {
  const content: ToolResultMessage["content"] = resultText
    ? [{ type: "text", text: resultText }]
    : [];

  return renderToolResultContent(toolName, args, content, isError, opts);
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
    const markdown = renderMarkdownTextBlock(
      msg.content,
      opts.theme,
      opts.previewWidth,
    );
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
): Node {
  return renderToolResultContent(toolName, args, content, isError, renderOpts);
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
      ),
    );
  }

  return nodes;
}
