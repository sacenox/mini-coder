/**
 * Conversation-log rendering for the terminal UI.
 *
 * Renders user, assistant, tool, and UI-only messages into cel-tui nodes.
 * Streaming state is passed in explicitly so the top-level UI module can keep
 * ownership of module-scoped runtime state while this module stays pure.
 *
 * @module
 */

import { Markdown } from "@cel-tui/components";
import { HStack, Text, VStack } from "@cel-tui/core";
import type { Node } from "@cel-tui/types";
import type {
  AssistantMessage,
  TextContent,
  ToolResultMessage,
  UserMessage,
} from "@mariozechner/pi-ai";
import { structuredPatch } from "diff";
import type { AppState } from "../index.ts";
import type { UiMessage } from "../session.ts";
import type { Theme } from "../theme.ts";

/** Max body lines shown for tool results when verbose mode is off. */
const UI_TOOL_PREVIEW_LINES = 20;

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

/** Semantic line kinds used when rendering tool output in the log. */
type ToolRenderLineKind =
  | "command"
  | "path"
  | "toolName"
  | "text"
  | "diffAdded"
  | "diffRemoved"
  | "summary"
  | "error";

/** A single logical line in a rendered tool block. */
export interface ToolRenderLine {
  /** Semantic line kind for styling. */
  kind: ToolRenderLineKind;
  /** Text content for this line. */
  text: string;
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

/** Render markdown blocks with stable top-level containers. */
function renderMarkdownContent(content: string): Node[] {
  return Markdown(content).map((node) => {
    if (node.type === "text" && node.content === "") {
      return node;
    }
    return HStack({ padding: { x: 1 } }, [VStack({ flex: 1 }, [node])]);
  });
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

function renderAssistantContentBlock(
  block: AssistantMessage["content"][number],
  opts: ConversationRenderOpts,
): Node[] {
  if (block.type === "text" && block.text) {
    return renderMarkdownContent(block.text);
  }
  if (block.type === "thinking" && block.thinking) {
    return [renderThinkingBlock(block.thinking, opts)];
  }
  if (block.type === "toolCall") {
    return renderToolCall(block, opts);
  }
  return [];
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
  const children = assistant.content.flatMap((block) => {
    return renderAssistantContentBlock(block, opts);
  });

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

  return VStack({}, children);
}

/** Split multi-line tool text into logical render lines. */
function splitToolTextLines(
  text: string,
  kind: Exclude<
    ToolRenderLineKind,
    "command" | "path" | "toolName" | "summary"
  >,
): ToolRenderLine[] {
  if (text === "") {
    return [];
  }
  return text.split("\n").map((line) => ({ kind, text: line }));
}

/** Read a string argument from a tool-call argument map. */
function getToolArgString(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  return typeof value === "string" ? value : "";
}

/**
 * Apply the UI preview policy to tool body lines.
 *
 * When verbose mode is off, only the first `maxLines` body lines are shown,
 * followed by a summary line reporting how many lines remain hidden.
 *
 * @param lines - Full body lines for the tool output.
 * @param verbose - Whether verbose mode is enabled.
 * @param maxLines - Maximum visible body lines in preview mode.
 * @returns The lines to render in the conversation log.
 */
export function previewToolRenderLines(
  lines: readonly ToolRenderLine[],
  verbose: boolean,
  maxLines = UI_TOOL_PREVIEW_LINES,
): ToolRenderLine[] {
  if (verbose || lines.length <= maxLines) {
    return [...lines];
  }

  return [
    ...lines.slice(0, maxLines),
    {
      kind: "summary",
      text: `And ${lines.length - maxLines} lines more`,
    },
  ];
}

/** Strip shell execution labels that should not appear in the UI. */
function normalizeShellOutput(output: string): string {
  return output
    .replace(/^Exit code: \d+\n?/, "")
    .replace(/(^|\n)\[stderr\]\n/g, "$1");
}

/** Build the logical render lines for a shell tool result. */
function buildShellToolLines(
  output: string,
  verbose: boolean,
): ToolRenderLine[] {
  return previewToolRenderLines(
    splitToolTextLines(normalizeShellOutput(output), "text"),
    verbose,
  );
}

function buildStructuredDiffLines(
  oldText: string,
  newText: string,
): ToolRenderLine[] {
  const patch = structuredPatch("", "", oldText, newText, "", "", {
    context: 2,
  });
  const diffLines: ToolRenderLine[] = [];

  for (const hunk of patch.hunks) {
    diffLines.push({
      kind: "text",
      text: `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`,
    });

    for (const line of hunk.lines) {
      if (line.startsWith("+")) {
        diffLines.push({ kind: "diffAdded", text: line });
      } else if (line.startsWith("-")) {
        diffLines.push({ kind: "diffRemoved", text: line });
      } else {
        diffLines.push({ kind: "text", text: line });
      }
    }
  }

  return diffLines;
}

function splitPrefixedToolTextLines(
  text: string,
  kind: "diffAdded" | "diffRemoved",
  prefix: string,
): ToolRenderLine[] {
  if (text === "") {
    return [];
  }

  const lines = text.split("\n");
  if (lines.at(-1) === "") {
    lines.pop();
  }

  return lines.map((line) => ({
    kind,
    text: `${prefix}${line}`,
  }));
}

/** Build the logical render lines for an edit tool result. */
function buildEditToolLines(
  _filePath: string,
  oldText: string,
  newText: string,
  isError: boolean,
  resultText: string,
  verbose: boolean,
): ToolRenderLine[] {
  if (isError) {
    return previewToolRenderLines(
      splitToolTextLines(resultText, "error"),
      verbose,
    );
  }

  const diffLines = buildStructuredDiffLines(oldText, newText);

  return previewToolRenderLines(
    diffLines.length > 0
      ? diffLines
      : [{ kind: "summary", text: "(empty file)" }],
    verbose,
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
    case "toolName":
      return Text(line.text, {
        fgColor: theme.secondaryAccentText,
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

/** Render a tool block with a left border. */
function renderToolBlock(lines: readonly ToolRenderLine[], theme: Theme): Node {
  return HStack({ padding: { x: 1 } }, [
    Text("│ ", { fgColor: theme.toolBorder }),
    VStack({ flex: 1, fgColor: theme.toolText }, renderToolLines(lines, theme)),
  ]);
}

function getToolContentText(content: ToolResultMessage["content"]): string {
  return content
    .filter((entry): entry is TextContent => entry.type === "text")
    .map((entry) => entry.text)
    .join("\n");
}

function buildToolHeaderLine(
  toolName: string,
  args: Record<string, unknown>,
): ToolRenderLine | null {
  if (toolName === "shell") {
    const command = getToolArgString(args, "command");
    return command ? { kind: "command", text: `$ ${command}` } : null;
  }

  if (toolName === "edit" || toolName === "readImage") {
    const filePath = getToolArgString(args, "path");
    return filePath ? { kind: "path", text: `~ ${filePath}` } : null;
  }

  return { kind: "toolName", text: toolName };
}

function buildEditToolCallLines(
  filePath: string,
  oldText: string,
  newText: string,
  verbose: boolean,
): ToolRenderLine[] {
  const lines: ToolRenderLine[] = [];
  if (filePath) {
    lines.push({ kind: "path", text: `~ ${filePath}` });
  }

  const bodyLines = previewToolRenderLines(
    [
      ...splitPrefixedToolTextLines(oldText, "diffRemoved", "-"),
      ...splitPrefixedToolTextLines(newText, "diffAdded", "+"),
    ],
    verbose,
  );

  return [...lines, ...bodyLines];
}

function buildToolCallLines(
  toolName: string,
  args: Record<string, unknown>,
  verbose: boolean,
): ToolRenderLine[] {
  if (toolName === "shell" || toolName === "readImage") {
    const header = buildToolHeaderLine(toolName, args);
    return header ? [header] : [];
  }

  if (toolName === "edit") {
    return buildEditToolCallLines(
      getToolArgString(args, "path"),
      getToolArgString(args, "oldText"),
      getToolArgString(args, "newText"),
      verbose,
    );
  }

  const text = JSON.stringify(args, null, 2);
  if (!text || text === "{}") {
    const header = buildToolHeaderLine(toolName, args);
    return header ? [header] : [];
  }

  return [
    { kind: "toolName", text: toolName },
    ...previewToolRenderLines(splitToolTextLines(text, "text"), verbose),
  ];
}

function renderToolCall(
  toolCall: Extract<AssistantMessage["content"][number], { type: "toolCall" }>,
  opts: Pick<ConversationRenderOpts, "verbose" | "theme">,
): Node[] {
  const lines = buildToolCallLines(
    toolCall.name,
    toolCall.arguments,
    opts.verbose,
  );
  return lines.length > 0 ? [renderToolBlock(lines, opts.theme)] : [];
}

function buildReadImageToolLines(
  content: ToolResultMessage["content"],
  isError: boolean,
  verbose: boolean,
): ToolRenderLine[] {
  if (isError) {
    return previewToolRenderLines(
      splitToolTextLines(getToolContentText(content), "error"),
      verbose,
    );
  }

  return [{ kind: "text", text: "Read image." }];
}

function buildGenericToolLines(
  toolName: string,
  output: string,
  isError: boolean,
): ToolRenderLine[] {
  return [
    { kind: "toolName", text: toolName },
    ...splitToolTextLines(output, isError ? "error" : "text"),
  ];
}

function renderToolResultContent(
  toolName: string,
  args: Record<string, unknown>,
  content: ToolResultMessage["content"],
  isError: boolean,
  opts: Pick<ConversationRenderOpts, "verbose" | "theme">,
): Node {
  if (toolName === "shell") {
    return renderToolBlock(
      buildShellToolLines(getToolContentText(content), opts.verbose),
      opts.theme,
    );
  }
  if (toolName === "edit") {
    return renderToolBlock(
      buildEditToolLines(
        getToolArgString(args, "path"),
        getToolArgString(args, "oldText"),
        getToolArgString(args, "newText"),
        isError,
        getToolContentText(content),
        opts.verbose,
      ),
      opts.theme,
    );
  }
  if (toolName === "readImage") {
    return renderToolBlock(
      buildReadImageToolLines(content, isError, opts.verbose),
      opts.theme,
    );
  }

  return renderToolBlock(
    buildGenericToolLines(toolName, getToolContentText(content), isError),
    opts.theme,
  );
}

/**
 * Render a tool result, dispatching by tool name.
 *
 * @param toolName - Tool name to render.
 * @param args - Tool call arguments used for headers and diffs.
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

/** Render an internal UI message in the conversation log. */
function renderUiMessage(msg: UiMessage, theme: Theme): Node {
  return VStack({ padding: { x: 1 } }, [
    Text(msg.content, {
      fgColor: theme.mutedText,
      italic: true,
      wrap: "word",
    }),
  ]);
}

type ConversationMessage = AppState["messages"][number];

function pushConversationNode(nodes: Node[], node: Node | null): void {
  if (!node) {
    return;
  }
  if (nodes.length > 0) {
    nodes.push(Text(""));
  }
  nodes.push(node);
}

function rememberToolCallArgs(
  message: AssistantMessage,
  toolCallArgs: Map<string, { name: string; args: Record<string, unknown> }>,
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
  toolCallArgs: Map<string, { name: string; args: Record<string, unknown> }>,
  theme: Theme,
): Node | null {
  if (message.role === "ui") {
    return renderUiMessage(message, theme);
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
    info?.args ?? {},
    message.content,
    message.isError,
    renderOpts,
  );
}

/**
 * Build the full conversation log as an array of nodes.
 *
 * @param state - Conversation rendering state.
 * @param streaming - Current in-progress assistant tail, if any.
 * @returns The rendered conversation log nodes.
 */
export function buildConversationLogNodes(
  state: Pick<AppState, "messages" | "showReasoning" | "verbose" | "theme">,
  streaming: StreamingConversationState,
): Node[] {
  const nodes: Node[] = [];
  const renderOpts: ConversationRenderOpts = {
    showReasoning: state.showReasoning,
    verbose: state.verbose,
    theme: state.theme,
  };
  const toolCallArgs = new Map<
    string,
    { name: string; args: Record<string, unknown> }
  >();

  for (const message of state.messages) {
    pushConversationNode(
      nodes,
      renderConversationMessage(message, renderOpts, toolCallArgs, state.theme),
    );
  }

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
    const info = toolCallArgs.get(pendingToolResult.toolCallId);
    pushConversationNode(
      nodes,
      renderToolResultMessage(
        info?.name ?? pendingToolResult.toolName,
        info?.args ?? {},
        pendingToolResult.content,
        pendingToolResult.isError,
        renderOpts,
      ),
    );
  }

  return nodes;
}
