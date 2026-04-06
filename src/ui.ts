/**
 * Terminal UI for mini-coder.
 *
 * Owns the cel-tui lifecycle (init/stop), renders the conversation log,
 * input area, animated divider, and status bar. Wires user input to the
 * agent loop and streams events back to the UI.
 *
 * @module
 */

import { exec } from "node:child_process";
import { homedir, platform } from "node:os";
import type { SelectInstance } from "@cel-tui/components";
import { Divider, Markdown, Select, Spacer } from "@cel-tui/components";
import {
  cel,
  HStack,
  ProcessTerminal,
  Text,
  TextInput,
  VStack,
} from "@cel-tui/core";
import type { Node } from "@cel-tui/types";
import type {
  AssistantMessage,
  Message,
  TextContent,
  ThinkingContent,
  ThinkingLevel,
  ToolCall,
} from "@mariozechner/pi-ai";
import type { OAuthProviderInterface } from "@mariozechner/pi-ai/oauth";
import { getOAuthProviders } from "@mariozechner/pi-ai/oauth";
import { structuredPatch } from "diff";
import type { AgentEvent } from "./agent.ts";
import { runAgentLoop } from "./agent.ts";
import { getGitState } from "./git.ts";
import type { AppState } from "./index.ts";
import {
  buildPrompt,
  buildToolList,
  getAvailableModels,
  MAX_SESSIONS_PER_CWD,
  saveOAuthCredentials,
  shutdown,
} from "./index.ts";
import { COMMANDS, parseInput } from "./input.ts";
import {
  appendMessage,
  computeStats,
  createSession,
  createUiMessage,
  filterModelMessages,
  forkSession,
  listSessions,
  loadMessages,
  truncateSessions,
  type UiMessage,
  undoLastTurn,
} from "./session.ts";
import { updateSettings } from "./settings.ts";
import type { Theme } from "./theme.ts";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Max body lines shown for tool results when verbose mode is off. */
const UI_TOOL_PREVIEW_LINES = 20;

/** Divider animation speed (ms per frame). */
const DIVIDER_FRAME_MS = 60;

/** Width of the bright pulse segment in the animated divider. */
const PULSE_WIDTH = 5;

/** Conservative fixed estimate for an image block's token footprint. */
const ESTIMATED_IMAGE_TOKENS = 1_200;

// ---------------------------------------------------------------------------
// UI state (module-scoped, not in AppState)
// ---------------------------------------------------------------------------

/** Scroll position for the conversation log. */
let scrollOffset = 0;

/** Whether the log auto-scrolls to the bottom. */
let stickToBottom = true;

/** Current text in the input area. */
let inputValue = "";

/** Whether the text input is focused. */
let inputFocused = true;

/** Animated divider frame counter. */
let dividerTick = 0;

/** Divider animation timer handle. */
let dividerTimer: ReturnType<typeof setInterval> | null = null;

/** Streaming text buffer for the current assistant response. */
let streamingText = "";

/** Streaming thinking buffer for the current assistant response. */
let streamingThinking = "";

/** Whether we are currently streaming a response. */
let isStreaming = false;

/**
 * A tool call observed during streaming, before it lands in history.
 *
 * Stores the tool name and arguments from `tool_start`, progressive
 * text updates from `tool_delta`, and the final result from `tool_end`.
 */
/** A pending tool call shown in the streaming tail. */
export interface PendingToolCall {
  /** Tool call id from the assistant message. */
  toolCallId: string;
  /** Tool name. */
  name: string;
  /** Tool call arguments. */
  args: Record<string, unknown>;
  /** Progressive text output captured so far. */
  resultText: string;
  /** Whether the tool result was an error. */
  isError: boolean;
  /** Whether the tool has finished. */
  done: boolean;
}

/** Render options shared by completed and streaming assistant content. */
export interface ConversationRenderOpts {
  /** Whether reasoning blocks are visible. */
  showReasoning: boolean;
  /** Whether tool output should be truncated in the UI. */
  verbose: boolean;
  /** Active UI theme. */
  theme: Theme;
}

/** Display-only assistant content that is still streaming. */
export interface StreamingRenderState {
  /** Streamed markdown text so far. */
  text: string;
  /** Streamed thinking text so far. */
  thinking: string;
  /** Tool calls observed in the current streaming turn. */
  pendingToolCalls: PendingToolCall[];
}

/** Semantic line kinds used when rendering tool output in the log. */
export type ToolRenderLineKind =
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

/** Tool calls collected during the current streaming turn. */
let pendingToolCalls: PendingToolCall[] = [];

// ---------------------------------------------------------------------------
// Overlay state
// ---------------------------------------------------------------------------

/** Max visible items in the overlay Select. */
const OVERLAY_MAX_VISIBLE = 15;

/** Horizontal padding around the overlay modal. */
const OVERLAY_PADDING_X = 4;

/** Active overlay for interactive commands (/model, /effort, etc.). */
let activeOverlay: {
  /** The Select component instance. */
  select: SelectInstance;
  /** Title displayed above the Select. */
  title: string;
} | null = null;

// ---------------------------------------------------------------------------
// Divider animation
// ---------------------------------------------------------------------------

/** Start the scanning pulse animation on the divider. */
function startDividerAnimation(): void {
  stopDividerAnimation();
  dividerTick = 0;
  dividerTimer = setInterval(() => {
    dividerTick++;
    cel.render();
  }, DIVIDER_FRAME_MS);
}

/** Stop the divider animation. */
function stopDividerAnimation(): void {
  if (dividerTimer) {
    clearInterval(dividerTimer);
    dividerTimer = null;
  }
}

/**
 * Render the animated divider.
 *
 * When the agent is working, a bright segment sweeps across the dimmed
 * line. When idle, it's a static dimmed line.
 */
function renderDivider(state: AppState, width: number): Node {
  if (!state.running) {
    return Text("─", { repeat: "fill", fgColor: state.theme.divider });
  }

  const total = Math.max(width, 1);
  const pos = dividerTick % (total + PULSE_WIDTH);
  const pulseStart = Math.max(0, pos - PULSE_WIDTH);
  const pulseEnd = Math.min(pos, total);
  const pulseLen = pulseEnd - pulseStart;
  const beforeLen = pulseStart;
  const afterLen = total - pulseEnd;

  const segments: Node[] = [];
  if (beforeLen > 0) {
    segments.push(
      Text("─", { repeat: beforeLen, fgColor: state.theme.divider }),
    );
  }
  if (pulseLen > 0) {
    segments.push(
      Text("═", {
        repeat: pulseLen,
        fgColor: state.theme.dividerPulse,
      }),
    );
  }
  if (afterLen > 0) {
    segments.push(
      Text("─", { repeat: afterLen, fgColor: state.theme.divider }),
    );
  }

  return HStack({ height: 1 }, segments);
}

// ---------------------------------------------------------------------------
// Status bar formatting
// ---------------------------------------------------------------------------

/** Abbreviate a path with ~ for the home directory. */
function abbreviatePath(p: string): string {
  const home = homedir();
  if (p === home) return "~";
  if (p.startsWith(`${home}/`)) return `~${p.slice(home.length)}`;
  return p;
}

/** Format a token count with human-friendly units (1.2k, 45k, 1.2M). */
function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

/** Format a token capacity, trimming unnecessary trailing `.0`. */
function formatTokenCapacity(n: number): string {
  return formatTokens(n).replace(/\.0([kM])$/, "$1");
}

/** Format a dollar cost. */
function formatCost(cost: number): string {
  return `$${cost.toFixed(2)}`;
}

/** Format the effort level for display. */
function formatEffort(effort: string): string {
  const map: Record<string, string> = {
    minimal: "min",
    low: "low",
    medium: "med",
    high: "high",
    xhigh: "xhigh",
  };
  return map[effort] ?? effort;
}

/** Format git status for the status bar right side. */
function formatGitStatus(state: AppState): string {
  if (!state.git) return "";
  const parts: string[] = [state.git.branch];
  if (state.git.staged > 0) parts.push(`+${state.git.staged}`);
  if (state.git.modified > 0) parts.push(`~${state.git.modified}`);
  if (state.git.untracked > 0) parts.push(`?${state.git.untracked}`);
  if (state.git.ahead > 0) parts.push(`▲ ${state.git.ahead}`);
  if (state.git.behind > 0) parts.push(`▼ ${state.git.behind}`);
  return parts.join(" ");
}

/** Format model info for the status bar left side. */
function formatModelInfo(state: AppState): string {
  if (!state.model) return "no model";
  return `${state.model.provider}/${state.model.id} · ${formatEffort(state.effort)}`;
}

/** Calculate context tokens from assistant usage, falling back when `totalTokens` is zero. */
function calculateUsageTokens(usage: AssistantMessage["usage"]): number {
  return (
    usage.totalTokens ||
    usage.input + usage.output + usage.cacheRead + usage.cacheWrite
  );
}

/** Estimate token usage from a character count using a conservative chars/4 heuristic. */
function estimateCharacterTokens(charCount: number): number {
  return Math.ceil(charCount / 4);
}

/** Estimate token usage for a model-visible message. */
function estimateMessageTokens(message: Message): number {
  switch (message.role) {
    case "user": {
      if (typeof message.content === "string") {
        return estimateCharacterTokens(message.content.length);
      }

      let chars = 0;
      let imageTokens = 0;
      for (const block of message.content) {
        if (block.type === "text") {
          chars += block.text.length;
        } else if (block.type === "image") {
          imageTokens += ESTIMATED_IMAGE_TOKENS;
        }
      }
      return estimateCharacterTokens(chars) + imageTokens;
    }
    case "assistant": {
      let chars = 0;
      for (const block of message.content) {
        if (block.type === "text") {
          chars += block.text.length;
        } else if (block.type === "thinking") {
          chars += block.thinking.length;
        } else if (block.type === "toolCall") {
          chars += block.name.length + JSON.stringify(block.arguments).length;
        }
      }
      return estimateCharacterTokens(chars);
    }
    case "toolResult": {
      let chars = 0;
      let imageTokens = 0;
      for (const block of message.content) {
        if (block.type === "text") {
          chars += block.text.length;
        } else if (block.type === "image") {
          imageTokens += ESTIMATED_IMAGE_TOKENS;
        }
      }
      return estimateCharacterTokens(chars) + imageTokens;
    }
  }
}

/** Find the latest assistant usage that can anchor context estimation. */
function getLatestValidAssistantUsage(
  messages: readonly Message[],
): { index: number; tokens: number } | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (
      message?.role === "assistant" &&
      message.stopReason !== "aborted" &&
      message.stopReason !== "error"
    ) {
      return {
        index: i,
        tokens: calculateUsageTokens(message.usage),
      };
    }
  }
  return null;
}

/** Estimate the current model-visible context size for the next request. */
function estimateCurrentContextTokens(state: AppState): number {
  const messages = filterModelMessages(state.messages);
  const latestUsage = getLatestValidAssistantUsage(messages);

  if (!latestUsage) {
    return messages.reduce((total, message) => {
      return total + estimateMessageTokens(message);
    }, 0);
  }

  let total = latestUsage.tokens;
  for (let i = latestUsage.index + 1; i < messages.length; i++) {
    total += estimateMessageTokens(messages[i]!);
  }
  return total;
}

/** Format cumulative session totals plus estimated current context usage for the status bar. */
function formatUsage(state: AppState): string {
  if (!state.model) return "";
  const inp = formatTokens(state.stats.totalInput);
  const out = formatTokens(state.stats.totalOutput);
  const contextTokens = estimateCurrentContextTokens(state);
  const ctxPct =
    state.model.contextWindow > 0
      ? (contextTokens / state.model.contextWindow) * 100
      : 0;
  const ctxWindow = formatTokenCapacity(state.model.contextWindow);
  return `in:${inp} out:${out} · ${ctxPct.toFixed(1)}%/${ctxWindow} · ${formatCost(state.stats.totalCost)}`;
}

// ---------------------------------------------------------------------------
// Message rendering
// ---------------------------------------------------------------------------

/** Render a user message with a subtle background. */
function renderUserMessage(msg: Message, theme: AppState["theme"]): Node {
  const text =
    typeof msg.content === "string"
      ? msg.content
      : msg.content
          .filter((c): c is TextContent => c.type === "text")
          .map((c) => c.text)
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

/** Render a completed assistant message from history. */
export function renderAssistantMessage(
  msg: AssistantMessage,
  opts: ConversationRenderOpts,
): Node | null {
  const children: Node[] = [];

  for (const block of msg.content) {
    if (block.type === "text" && (block as TextContent).text) {
      children.push(...renderMarkdownContent((block as TextContent).text));
    } else if (block.type === "thinking" && opts.showReasoning) {
      const thinking = (block as ThinkingContent).thinking;
      if (thinking) {
        children.push(
          VStack({ padding: { x: 1 } }, [
            Text(thinking, {
              wrap: "word",
              fgColor: opts.theme.mutedText,
              italic: true,
            }),
          ]),
        );
      }
    }
  }

  if (msg.stopReason === "error" && msg.errorMessage) {
    children.push(
      VStack({ padding: { x: 1 } }, [
        Text(`Error: ${msg.errorMessage}`, {
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

/** Build the logical render lines for a shell tool result. */
function buildShellToolLines(
  command: string,
  output: string,
  verbose: boolean,
): ToolRenderLine[] {
  return [
    { kind: "command", text: `$ ${command}` },
    ...previewToolRenderLines(splitToolTextLines(output, "text"), verbose),
  ];
}

/** Build the logical render lines for an edit tool result. */
function buildEditToolLines(
  filePath: string,
  oldText: string,
  newText: string,
  isError: boolean,
  resultText: string,
  verbose: boolean,
): ToolRenderLine[] {
  if (isError) {
    return [
      { kind: "path", text: `~ ${filePath}` },
      ...previewToolRenderLines(
        splitToolTextLines(resultText, "error"),
        verbose,
      ),
    ];
  }

  if (oldText === "") {
    return [
      { kind: "path", text: `~ ${filePath}` },
      { kind: "diffAdded", text: "(new file)" },
    ];
  }

  const patch = structuredPatch("", "", oldText, newText, "", "", {
    context: 2,
  });
  const diffLines: ToolRenderLine[] = [];

  for (const hunk of patch.hunks) {
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

  return [
    { kind: "path", text: `~ ${filePath}` },
    ...previewToolRenderLines(diffLines, verbose),
  ];
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

/** Extract text blocks from a tool result for UI rendering. */
function getToolResultText(
  result: Extract<AgentEvent, { type: "tool_delta" | "tool_end" }>["result"],
): string {
  return result.content
    .filter((content): content is TextContent => content.type === "text")
    .map((content) => content.text)
    .join("\n");
}

/** Render a shell tool call with left border. */
function renderShellToolCall(
  command: string,
  output: string,
  _isError: boolean,
  opts: Pick<ConversationRenderOpts, "verbose" | "theme">,
): Node {
  return renderToolBlock(
    buildShellToolLines(command, output, opts.verbose),
    opts.theme,
  );
}

/** Render an edit tool call with file path and unified diff. */
function renderEditToolCall(
  filePath: string,
  oldText: string,
  newText: string,
  isError: boolean,
  resultText: string,
  opts: Pick<ConversationRenderOpts, "verbose" | "theme">,
): Node {
  return renderToolBlock(
    buildEditToolLines(
      filePath,
      oldText,
      newText,
      isError,
      resultText,
      opts.verbose,
    ),
    opts.theme,
  );
}

/** Render a generic (plugin) tool call with left border. */
function renderGenericToolCall(
  toolName: string,
  output: string,
  isError: boolean,
  theme: Theme,
): Node {
  const lines: ToolRenderLine[] = [
    { kind: "toolName", text: toolName },
    ...splitToolTextLines(output, isError ? "error" : "text"),
  ];

  return renderToolBlock(lines, theme);
}

/**
 * Render a tool result, dispatching by tool name.
 *
 * @param toolName - Tool name to render.
 * @param args - Tool call arguments used for headers/diffs.
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
  if (toolName === "shell") {
    return renderShellToolCall(args.command as string, resultText, isError, {
      verbose: opts.verbose,
      theme: opts.theme,
    });
  }
  if (toolName === "edit") {
    return renderEditToolCall(
      args.path as string,
      args.oldText as string,
      args.newText as string,
      isError,
      resultText,
      {
        verbose: opts.verbose,
        theme: opts.theme,
      },
    );
  }
  return renderGenericToolCall(toolName, resultText, isError, opts.theme);
}

// ---------------------------------------------------------------------------
// Streaming response rendering
// ---------------------------------------------------------------------------

/** Render a pending tool call, including progressive output when available. */
function renderPendingToolCall(
  toolCall: PendingToolCall,
  opts: Pick<ConversationRenderOpts, "verbose" | "theme">,
): Node {
  const runningLine: ToolRenderLine = {
    kind: "summary",
    text: "Running...",
  };

  if (toolCall.resultText) {
    if (toolCall.name === "shell") {
      return renderToolBlock(
        [
          ...buildShellToolLines(
            toolCall.args.command as string,
            toolCall.resultText,
            opts.verbose,
          ),
          ...(toolCall.done ? [] : [runningLine]),
        ],
        opts.theme,
      );
    }

    if (toolCall.name === "edit") {
      return renderToolBlock(
        [
          { kind: "path", text: `~ ${String(toolCall.args.path ?? "")}` },
          ...previewToolRenderLines(
            splitToolTextLines(
              toolCall.resultText,
              toolCall.isError ? "error" : "text",
            ),
            opts.verbose,
          ),
          ...(toolCall.done ? [] : [runningLine]),
        ],
        opts.theme,
      );
    }

    return renderToolBlock(
      [
        { kind: "toolName", text: toolCall.name },
        ...splitToolTextLines(
          toolCall.resultText,
          toolCall.isError ? "error" : "text",
        ),
        ...(toolCall.done ? [] : [runningLine]),
      ],
      opts.theme,
    );
  }

  const label =
    toolCall.name === "shell"
      ? `$ ${toolCall.args.command ?? ""}`
      : toolCall.name === "edit"
        ? `~ ${toolCall.args.path ?? ""}`
        : toolCall.name;

  return renderToolBlock(
    [
      {
        kind:
          toolCall.name === "shell"
            ? "command"
            : toolCall.name === "edit"
              ? "path"
              : "toolName",
        text: label,
      },
      ...(toolCall.done ? [] : [runningLine]),
    ],
    opts.theme,
  );
}

/**
 * Render the in-progress streaming response.
 *
 * Shows thinking (if enabled), streamed markdown, and pending tool calls.
 */
export function renderStreamingResponse(
  streaming: StreamingRenderState,
  opts: ConversationRenderOpts,
): Node | null {
  const children: Node[] = [];

  if (opts.showReasoning && streaming.thinking) {
    children.push(
      VStack({ padding: { x: 1 } }, [
        Text(streaming.thinking, {
          wrap: "word",
          fgColor: opts.theme.mutedText,
          italic: true,
        }),
      ]),
    );
  }

  if (streaming.text) {
    children.push(...renderMarkdownContent(streaming.text));
  }

  for (const toolCall of streaming.pendingToolCalls) {
    children.push(renderPendingToolCall(toolCall, opts));
  }

  if (children.length === 0) {
    return null;
  }

  return VStack({}, children);
}

// ---------------------------------------------------------------------------
// Conversation log
// ---------------------------------------------------------------------------

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

/** Build the full conversation log as an array of nodes. */
export function buildConversationLog(state: AppState): Node[] {
  const nodes: Node[] = [];
  const renderOpts: ConversationRenderOpts = {
    showReasoning: state.showReasoning,
    verbose: state.verbose,
    theme: state.theme,
  };

  const pushConversationNode = (node: Node | null): void => {
    if (!node) return;
    if (nodes.length > 0) nodes.push(Text(""));
    nodes.push(node);
  };

  // Map toolCallId → { name, args } so we can render diffs for edits.
  const toolCallArgs = new Map<
    string,
    { name: string; args: Record<string, unknown> }
  >();

  for (const msg of state.messages) {
    if (msg.role === "ui") {
      pushConversationNode(renderUiMessage(msg, state.theme));
    } else if (msg.role === "user") {
      pushConversationNode(renderUserMessage(msg, state.theme));
    } else if (msg.role === "assistant") {
      const am = msg as AssistantMessage;
      for (const block of am.content) {
        if (block.type === "toolCall") {
          const tc = block as ToolCall;
          toolCallArgs.set(tc.id, { name: tc.name, args: tc.arguments });
        }
      }
      pushConversationNode(renderAssistantMessage(am, renderOpts));
    } else if (msg.role === "toolResult") {
      const info = toolCallArgs.get(msg.toolCallId);
      const name = info?.name ?? msg.toolName;
      const args = info?.args ?? {};
      const text = msg.content
        .filter((c): c is TextContent => c.type === "text")
        .map((c) => c.text)
        .join("\n");
      pushConversationNode(
        renderToolResult(name, args, text, msg.isError, renderOpts),
      );
    }
  }

  // Append in-progress streaming response
  if (isStreaming) {
    pushConversationNode(
      renderStreamingResponse(
        {
          text: streamingText,
          thinking: streamingThinking,
          pendingToolCalls,
        },
        renderOpts,
      ),
    );
  }

  // Empty state
  if (nodes.length === 0) {
    nodes.push(Spacer());
    nodes.push(
      VStack({ alignItems: "center" }, [
        Text(
          state.model
            ? "Ready. Type a message to start."
            : "No providers configured. Use /login to authenticate.",
          { fgColor: state.theme.mutedText, italic: true },
        ),
      ]),
    );
    nodes.push(Spacer());
  }

  return nodes;
}

// ---------------------------------------------------------------------------
// Overlay rendering
// ---------------------------------------------------------------------------

/** Dismiss the active overlay and return focus to the input. */
function dismissOverlay(): void {
  activeOverlay = null;
  inputFocused = true;
  cel.render();
}

/** Render the overlay layer (transparent background, centered modal). */
function renderOverlay(state: AppState): Node {
  // Fixed height: 1 (title) + 1 (search) + maxVisible items + 1 (overflow)
  const modalHeight = OVERLAY_MAX_VISIBLE + 3;

  return VStack(
    {
      height: "100%",
      justifyContent: "center",
      padding: { x: OVERLAY_PADDING_X },
    },
    [
      VStack(
        {
          height: modalHeight,
          bgColor: state.theme.overlayBg,
          padding: { x: 1 },
        },
        [
          Text(activeOverlay!.title, {
            bold: true,
            fgColor: state.theme.accentText,
          }),
          activeOverlay!.select(),
        ],
      ),
    ],
  );
}

// ---------------------------------------------------------------------------
// Status bar
// ---------------------------------------------------------------------------

/**
 * Render the two-line status bar.
 *
 * @param state - Application state.
 * @returns The status bar node.
 */
export function renderStatusBar(state: AppState): Node {
  return VStack(
    {
      height: 2,
      padding: { x: 1 },
      fgColor: state.theme.statusText,
    },
    [
      HStack({}, [
        Text(abbreviatePath(state.cwd)),
        Spacer(),
        Text(formatGitStatus(state), {
          fgColor: state.theme.secondaryAccentText,
        }),
      ]),
      HStack({}, [
        Text(formatModelInfo(state), {
          fgColor: state.theme.accentText,
        }),
        Spacer(),
        Text(formatUsage(state)),
      ]),
    ],
  );
}

// ---------------------------------------------------------------------------
// Input area
// ---------------------------------------------------------------------------

/** Stable callbacks for the controlled TextInput. */
export interface InputController {
  /** Update the controlled input value and re-render. */
  onChange: (value: string) => void;
  /** Mark the input as focused and re-render. */
  onFocus: () => void;
  /** Mark the input as blurred and re-render. */
  onBlur: () => void;
  /** Intercept submit/autocomplete keys before default editing runs. */
  onKeyPress: (key: string) => boolean | undefined;
}

/**
 * Create stable handlers for the main TextInput.
 *
 * cel-tui keys TextInput cursor/scroll state by the `onChange` function
 * reference, so these callbacks must be created once and reused across
 * renders.
 *
 * @param state - Application state used by the handlers.
 * @returns Stable callbacks for the controlled TextInput.
 */
export function createInputController(state: AppState): InputController {
  return {
    onChange: (value) => {
      inputValue = value;
      cel.render();
    },
    onFocus: () => {
      inputFocused = true;
      cel.render();
    },
    onBlur: () => {
      inputFocused = false;
      cel.render();
    },
    onKeyPress: (key) => {
      if (key === "enter") {
        const raw = inputValue;
        inputValue = "";
        cel.render();
        handleInput(raw, state);
        return false;
      }
      if (key === "tab" && inputValue.startsWith("/")) {
        showCommandAutocomplete(state);
        return false;
      }
    },
  };
}

/**
 * Render the padded input area.
 *
 * @param theme - Active UI theme.
 * @param controller - Stable TextInput callbacks.
 * @returns The input area node.
 */
export function renderInputArea(
  theme: Theme,
  controller: InputController,
): Node {
  return VStack({ padding: { x: 1 } }, [
    TextInput({
      flex: 1,
      maxHeight: 10,
      value: inputValue,
      onChange: controller.onChange,
      placeholder: Text("message…", { fgColor: theme.mutedText }),
      focused: inputFocused,
      onFocus: controller.onFocus,
      onBlur: controller.onBlur,
      onKeyPress: controller.onKeyPress,
    }),
  ]);
}

// ---------------------------------------------------------------------------
// Command handlers
// ---------------------------------------------------------------------------

/**
 * Apply a model selection to the active state and persisted settings.
 *
 * @param state - Application state.
 * @param model - Selected model.
 */
export function applyModelSelection(
  state: AppState,
  model: AppState["model"] & NonNullable<AppState["model"]>,
): void {
  state.model = model;
  state.settings = updateSettings(state.settingsPath, {
    defaultModel: `${model.provider}/${model.id}`,
  });
}

/**
 * Apply an effort selection to the active state and persisted settings.
 *
 * @param state - Application state.
 * @param effort - Selected reasoning effort.
 */
export function applyEffortSelection(
  state: AppState,
  effort: ThinkingLevel,
): void {
  state.effort = effort;
  state.settings = updateSettings(state.settingsPath, {
    defaultEffort: effort,
  });
}

/** Handle the /model command: show interactive model selector. */
function handleModelCommand(state: AppState): void {
  const models = getAvailableModels(state);
  if (models.length === 0) {
    // No providers — nothing to show
    return;
  }

  const currentValue = state.model
    ? `${state.model.provider}/${state.model.id}`
    : null;

  const items = models.map((m) => {
    const value = `${m.provider}/${m.id}`;
    const current = value === currentValue ? " (current)" : "";
    return {
      label: `${m.provider}/${m.id}${current}`,
      value,
      filterText: `${m.provider} ${m.id}`,
    };
  });

  const select = Select({
    items,
    maxVisible: OVERLAY_MAX_VISIBLE,
    placeholder: "type to filter models...",
    focused: true,
    highlightColor: state.theme.accentText,
    onSelect: (value) => {
      const picked = models.find((m) => `${m.provider}/${m.id}` === value);
      if (picked) {
        applyModelSelection(state, picked);
      }
      dismissOverlay();
    },
    onBlur: dismissOverlay,
  });

  inputFocused = false;
  activeOverlay = { select, title: "Select a model" };
  cel.render();
}

/** Effort levels available for selection. */
const EFFORT_LEVELS: { label: string; value: ThinkingLevel }[] = [
  { label: "low", value: "low" },
  { label: "medium", value: "medium" },
  { label: "high", value: "high" },
  { label: "xhigh", value: "xhigh" },
];

/** Handle the /effort command: show effort level selector. */
function handleEffortCommand(state: AppState): void {
  const items = EFFORT_LEVELS.map((e) => ({
    label: e.value === state.effort ? `${e.label} (current)` : e.label,
    value: e.value,
    filterText: e.label,
  }));

  const select = Select({
    items,
    maxVisible: OVERLAY_MAX_VISIBLE,
    placeholder: "type to filter...",
    focused: true,
    highlightColor: state.theme.accentText,
    onSelect: (value) => {
      applyEffortSelection(state, value as ThinkingLevel);
      dismissOverlay();
    },
    onBlur: dismissOverlay,
  });

  inputFocused = false;
  activeOverlay = { select, title: "Select effort level" };
  cel.render();
}

/** Handle the /session command: list and resume sessions. */
function handleSessionCommand(state: AppState): void {
  const sessions = listSessions(state.db, state.canonicalCwd);
  if (sessions.length === 0) {
    return;
  }

  const currentSessionId = state.session?.id ?? null;
  const items = sessions.map((s) => {
    const date = new Date(s.updatedAt);
    const dateStr = formatSessionDate(date);
    const model = s.model ?? "no model";
    const current = s.id === currentSessionId ? " (current)" : "";
    return {
      label: `${dateStr}  ${model}${current}`,
      value: s.id,
      filterText: `${dateStr} ${model}`,
    };
  });

  const select = Select({
    items,
    maxVisible: OVERLAY_MAX_VISIBLE,
    placeholder: "type to filter sessions...",
    focused: true,
    highlightColor: state.theme.accentText,
    onSelect: (sessionId) => {
      if (sessionId !== currentSessionId) {
        const picked = sessions.find((s) => s.id === sessionId);
        if (picked) {
          state.session = picked;
          state.messages = loadMessages(state.db, picked.id);
          state.stats = computeStats(state.messages);
          stickToBottom = true;
        }
      }
      dismissOverlay();
    },
    onBlur: dismissOverlay,
  });

  inputFocused = false;
  activeOverlay = { select, title: "Resume a session" };
  cel.render();
}

/** Format a session date for display. */
function formatSessionDate(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMs / 3_600_000);
  const diffDays = Math.floor(diffMs / 86_400_000);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

/** Open a URL in the user's default browser. */
function openInBrowser(url: string): void {
  const cmd = platform() === "darwin" ? "open" : "xdg-open";
  exec(`${cmd} ${JSON.stringify(url)}`);
}

/**
 * Ensure the app has an active persisted session.
 *
 * Creates the session lazily on the first user message and backfills any
 * pre-session UI messages currently shown in the log.
 *
 * @param state - Application state.
 * @returns The active persisted session.
 */
function ensureSession(state: AppState): NonNullable<AppState["session"]> {
  if (state.session) {
    return state.session;
  }

  const modelLabel = state.model
    ? `${state.model.provider}/${state.model.id}`
    : undefined;
  const session = createSession(state.db, {
    cwd: state.canonicalCwd,
    model: modelLabel,
    effort: state.effort,
  });
  truncateSessions(state.db, state.canonicalCwd, MAX_SESSIONS_PER_CWD);
  state.session = session;

  for (const message of state.messages) {
    appendMessage(state.db, session.id, message);
  }

  return session;
}

/**
 * Append a UI-only info message to the conversation log.
 *
 * When no persisted session exists yet, the message stays in memory and is
 * backfilled if the user later starts a session by sending a message.
 *
 * @param text - Display text to append.
 * @param state - Application state.
 */
function appendInfoMessage(text: string, state: AppState): void {
  const msg = createUiMessage(text);
  if (state.session) {
    appendMessage(state.db, state.session.id, msg);
  }
  state.messages.push(msg);
  stickToBottom = true;
  cel.render();
}

/** Handle the /new command: clear the current in-memory session state. */
function handleNewCommand(state: AppState): void {
  if (state.running) return;
  state.session = null;
  state.messages = [];
  state.stats = { totalInput: 0, totalOutput: 0, totalCost: 0 };
  stickToBottom = true;
  cel.render();
}

/** Handle the /fork command: fork the current session. */
function handleForkCommand(state: AppState): void {
  if (state.running || !state.session) return;
  const forked = forkSession(state.db, state.session.id);
  state.session = forked;
  state.messages = loadMessages(state.db, forked.id);
  state.stats = computeStats(state.messages);
  appendInfoMessage(`Forked session.`, state);
}

/** Handle the /undo command: remove the last turn. */
function handleUndoCommand(state: AppState): void {
  // Interrupt first if the agent is running
  if (state.running && state.abortController) {
    state.abortController.abort();
  }
  if (!state.session) {
    return;
  }
  const removed = undoLastTurn(state.db, state.session.id);
  if (removed) {
    state.messages = loadMessages(state.db, state.session.id);
    state.stats = computeStats(state.messages);
    stickToBottom = true;
    cel.render();
  }
}

/** Handle the /reasoning command: toggle thinking display. */
function handleReasoningCommand(state: AppState): void {
  state.showReasoning = !state.showReasoning;
  state.settings = updateSettings(state.settingsPath, {
    showReasoning: state.showReasoning,
  });
  cel.render();
}

/** Handle the /verbose command: toggle full output display. */
function handleVerboseCommand(state: AppState): void {
  state.verbose = !state.verbose;
  state.settings = updateSettings(state.settingsPath, {
    verbose: state.verbose,
  });
  cel.render();
}

/** Handle the /login command: OAuth provider login. */
function handleLoginCommand(state: AppState): void {
  const oauthProviders = getOAuthProviders();
  if (oauthProviders.length === 0) {
    return;
  }

  const items = oauthProviders.map((p) => {
    const loggedIn = state.oauthCredentials[p.id] != null;
    const status = loggedIn ? " (logged in)" : "";
    return {
      label: `${p.name}${status}`,
      value: p.id,
      filterText: p.name,
    };
  });

  const select = Select({
    items,
    maxVisible: OVERLAY_MAX_VISIBLE,
    placeholder: "type to filter providers...",
    focused: true,
    highlightColor: state.theme.accentText,
    onSelect: (providerId) => {
      dismissOverlay();
      const provider = oauthProviders.find((p) => p.id === providerId);
      if (provider) {
        performLogin(provider, state).catch((err) => {
          appendInfoMessage(
            `Login failed: ${err instanceof Error ? err.message : String(err)}`,
            state,
          );
        });
      }
    },
    onBlur: dismissOverlay,
  });

  inputFocused = false;
  activeOverlay = { select, title: "Login to a provider" };
  cel.render();
}

/** Run the OAuth login flow for a provider. */
async function performLogin(
  provider: OAuthProviderInterface,
  state: AppState,
): Promise<void> {
  appendInfoMessage(`Logging in to ${provider.name}...`, state);

  const credentials = await provider.login({
    onAuth: (info) => {
      openInBrowser(info.url);
      appendInfoMessage(
        info.instructions ?? "Opening browser for login...",
        state,
      );
    },
    onPrompt: () => {
      return Promise.reject(new Error("Manual code input is not supported."));
    },
    onProgress: (message) => {
      appendInfoMessage(message, state);
    },
  });

  // Persist credentials
  state.oauthCredentials[provider.id] = credentials;
  saveOAuthCredentials(state.oauthCredentials);

  // Register the provider's API key
  const apiKey = provider.getApiKey(credentials);
  state.providers.set(provider.id, apiKey);

  // Auto-select model if none was set
  if (!state.model) {
    const models = getAvailableModels(state);
    if (models.length > 0) {
      state.model = models[0]!;
    }
  }

  appendInfoMessage(`Logged in to ${provider.name}.`, state);
}

/** Handle the /logout command: clear OAuth credentials for a provider. */
function handleLogoutCommand(state: AppState): void {
  const loggedInProviders = getOAuthProviders().filter(
    (p) => state.oauthCredentials[p.id] != null,
  );
  if (loggedInProviders.length === 0) {
    return;
  }

  const items = loggedInProviders.map((p) => ({
    label: p.name,
    value: p.id,
    filterText: p.name,
  }));

  const select = Select({
    items,
    maxVisible: OVERLAY_MAX_VISIBLE,
    placeholder: "type to filter providers...",
    focused: true,
    highlightColor: state.theme.accentText,
    onSelect: (providerId) => {
      delete state.oauthCredentials[providerId];
      saveOAuthCredentials(state.oauthCredentials);
      state.providers.delete(providerId);

      // Clear model if it belonged to the logged-out provider
      if (state.model && state.model.provider === providerId) {
        state.model = null;
      }

      const provider = loggedInProviders.find((p) => p.id === providerId);
      dismissOverlay();
      appendInfoMessage(
        `Logged out of ${provider?.name ?? providerId}.`,
        state,
      );
    },
    onBlur: dismissOverlay,
  });

  inputFocused = false;
  activeOverlay = { select, title: "Logout from a provider" };
  cel.render();
}

/** Help text inputs derived from application state. */
export interface HelpRenderState {
  /** Available provider credentials keyed by provider id. */
  providers: AppState["providers"];
  /** Current model selection. */
  model: AppState["model"];
  /** Loaded AGENTS.md files. */
  agentsMd: AppState["agentsMd"];
  /** Discovered skills. */
  skills: AppState["skills"];
  /** Active plugins. */
  plugins: AppState["plugins"];
  /** Whether reasoning blocks are shown in the log. */
  showReasoning: AppState["showReasoning"];
  /** Whether full tool output is shown in the log. */
  verbose: AppState["verbose"];
}

/**
 * Build the `/help` text shown in the conversation log.
 *
 * @param state - Help-relevant application state.
 * @returns Multi-line help text for display.
 */
export function buildHelpText(state: HelpRenderState): string {
  const lines: string[] = [];

  // Commands
  lines.push("Commands:");
  for (const cmd of COMMANDS) {
    lines.push(`  /${cmd}  ${getHelpCommandDescription(cmd, state)}`);
  }

  // Providers
  const providerNames = Array.from(state.providers.keys());
  lines.push("");
  lines.push(
    providerNames.length > 0
      ? `Providers: ${providerNames.join(", ")}`
      : "Providers: none (use /login)",
  );

  // Model
  lines.push(
    state.model
      ? `Model: ${state.model.provider}/${state.model.id}`
      : "Model: none (use /model)",
  );

  // AGENTS.md files
  if (state.agentsMd.length > 0) {
    lines.push("");
    lines.push("AGENTS.md files:");
    for (const a of state.agentsMd) {
      lines.push(`  ${abbreviatePath(a.path)}`);
    }
  }

  // Skills
  if (state.skills.length > 0) {
    lines.push("");
    lines.push("Skills:");
    for (const s of state.skills) {
      const desc = s.description ? `  ${s.description}` : "";
      lines.push(`  ${s.name}${desc}`);
    }
  }

  // Plugins
  if (state.plugins.length > 0) {
    lines.push("");
    lines.push("Plugins:");
    for (const p of state.plugins) {
      lines.push(`  ${p.entry.name}`);
    }
  }

  return lines.join("\n");
}

/** Handle the /help command: show commands, providers, agents, skills, plugins. */
function handleHelpCommand(state: AppState): void {
  appendInfoMessage(buildHelpText(state), state);
}

/** Command descriptions for the autocomplete overlay. */
const COMMAND_DESCRIPTIONS: Record<string, string> = {
  model: "Select a model",
  effort: "Set reasoning effort",
  session: "Resume a session",
  new: "New session",
  fork: "Fork session",
  undo: "Undo last turn",
  reasoning: "Toggle thinking display",
  verbose: "Toggle full output",
  login: "OAuth login",
  logout: "OAuth logout",
  help: "Show help",
};

/**
 * Get the `/help` description for a command, including current state when relevant.
 *
 * @param command - Command name.
 * @param state - Help-relevant application state.
 * @returns Human-readable command description.
 */
function getHelpCommandDescription(
  command: (typeof COMMANDS)[number],
  state: Pick<HelpRenderState, "showReasoning" | "verbose">,
): string {
  const description = COMMAND_DESCRIPTIONS[command] ?? "";
  if (command === "reasoning") {
    return `${description} (currently ${state.showReasoning ? "on" : "off"})`;
  }
  if (command === "verbose") {
    return `${description} (currently ${state.verbose ? "on" : "off"})`;
  }
  return description;
}

/** Show command autocomplete overlay. */
function showCommandAutocomplete(state: AppState): void {
  const items = COMMANDS.map((cmd) => ({
    label: `/${cmd}  ${COMMAND_DESCRIPTIONS[cmd] ?? ""}`,
    value: cmd,
    filterText: cmd,
  }));

  const select = Select({
    items,
    maxVisible: OVERLAY_MAX_VISIBLE,
    placeholder: "type to filter commands...",
    focused: true,
    highlightColor: state.theme.accentText,
    onSelect: (value) => {
      dismissOverlay();
      handleInput(`/${value}`, state);
    },
    onBlur: dismissOverlay,
  });

  inputFocused = false;
  inputValue = "";
  activeOverlay = { select, title: "Commands" };
  cel.render();
}

/** Dispatch a parsed command. Returns true if handled. */
function handleCommand(command: string, state: AppState): boolean {
  switch (command) {
    case "model":
      handleModelCommand(state);
      return true;
    case "effort":
      handleEffortCommand(state);
      return true;
    case "session":
      handleSessionCommand(state);
      return true;
    case "login":
      handleLoginCommand(state);
      return true;
    case "logout":
      handleLogoutCommand(state);
      return true;
    case "new":
      handleNewCommand(state);
      return true;
    case "fork":
      handleForkCommand(state);
      return true;
    case "undo":
      handleUndoCommand(state);
      return true;
    case "reasoning":
      handleReasoningCommand(state);
      return true;
    case "verbose":
      handleVerboseCommand(state);
      return true;
    case "help":
      handleHelpCommand(state);
      return true;
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// Agent loop wiring
// ---------------------------------------------------------------------------

/** Route raw user input through parseInput and dispatch accordingly. */
export function handleInput(raw: string, state: AppState): void {
  const parsed = parseInput(raw);

  switch (parsed.type) {
    case "command":
      if (!handleCommand(parsed.command, state)) {
        // Unimplemented command — ignore for now
      }
      break;
    case "text":
      if (parsed.text) {
        submitMessage(parsed.text, state).catch((err) => {
          console.error("Submit error:", err);
        });
      }
      break;
    // skill and image handling will be added in Phase 4d
  }
}

/** Send a plain text message and run the agent loop. */
async function submitMessage(text: string, state: AppState): Promise<void> {
  if (!text.trim() || !state.model || state.running) return;

  const session = ensureSession(state);
  const userMessage: Message = {
    role: "user",
    content: text,
    timestamp: Date.now(),
  };

  // Append user message — returns the auto-assigned turn number
  const turn = appendMessage(state.db, session.id, userMessage);
  state.messages.push(userMessage);
  stickToBottom = true;
  cel.render();

  // Refresh git state before each turn
  state.git = await getGitState(state.cwd);

  const systemPrompt = buildPrompt(state);
  const { tools, toolHandlers } = buildToolList(state);

  // Start agent loop
  state.running = true;
  state.abortController = new AbortController();
  isStreaming = true;
  streamingText = "";
  streamingThinking = "";
  pendingToolCalls = [];
  startDividerAnimation();
  cel.render();

  try {
    await runAgentLoop({
      db: state.db,
      sessionId: session.id,
      turn,
      model: state.model,
      systemPrompt,
      tools,
      toolHandlers,
      messages: filterModelMessages(state.messages),
      cwd: state.cwd,
      apiKey: state.providers.get(state.model.provider),
      effort: state.effort,
      signal: state.abortController.signal,
      onEvent: (event) => handleAgentEvent(event, state),
    });
    state.messages = loadMessages(state.db, session.id);
    state.stats = computeStats(state.messages);
  } finally {
    state.running = false;
    state.abortController = null;
    isStreaming = false;
    streamingText = "";
    streamingThinking = "";
    pendingToolCalls = [];
    stopDividerAnimation();
    cel.render();
  }
}

/** Handle events emitted by the agent loop. */
function handleAgentEvent(event: AgentEvent, state: AppState): void {
  switch (event.type) {
    case "text_delta":
      streamingText += event.delta;
      stickToBottom = true;
      cel.render();
      break;

    case "thinking_delta":
      streamingThinking += event.delta;
      if (state.showReasoning) {
        stickToBottom = true;
        cel.render();
      }
      break;

    case "assistant_message":
      state.messages.push(event.message);
      state.stats = computeStats(state.messages);
      streamingText = "";
      streamingThinking = "";
      stickToBottom = true;
      cel.render();
      break;

    case "tool_start":
      pendingToolCalls.push({
        toolCallId: event.toolCallId,
        name: event.name,
        args: event.args,
        resultText: "",
        isError: false,
        done: false,
      });
      stickToBottom = true;
      cel.render();
      break;

    case "tool_delta": {
      const pending = pendingToolCalls.find(
        (toolCall) => toolCall.toolCallId === event.toolCallId,
      );
      if (pending) {
        pending.resultText = getToolResultText(event.result);
        pending.isError = event.result.isError;
      }
      stickToBottom = true;
      cel.render();
      break;
    }

    case "tool_end": {
      const pending = pendingToolCalls.find(
        (toolCall) => toolCall.toolCallId === event.toolCallId,
      );
      if (pending) {
        pending.resultText = getToolResultText(event.result);
        pending.isError = event.result.isError;
        pending.done = true;
      }
      stickToBottom = true;
      cel.render();
      break;
    }

    case "tool_result":
      state.messages.push(event.message);
      pendingToolCalls = pendingToolCalls.filter(
        (toolCall) => toolCall.toolCallId !== event.message.toolCallId,
      );
      stickToBottom = true;
      cel.render();
      break;

    case "done":
    case "error":
    case "aborted":
      streamingText = "";
      streamingThinking = "";
      pendingToolCalls = [];
      isStreaming = false;
      stickToBottom = true;
      cel.render();
      break;
  }
}

// ---------------------------------------------------------------------------
// Graceful exit
// ---------------------------------------------------------------------------

/** Shut down cleanly and exit. */
async function gracefulExit(state: AppState): Promise<void> {
  stopDividerAnimation();
  if (state.abortController) state.abortController.abort();
  cel.stop();
  await shutdown(state);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/**
 * Start the terminal UI.
 *
 * Initializes cel-tui, sets up the viewport, and takes over the terminal.
 * Does not return until the user exits.
 *
 * @param state - The initialized application state from {@link init}.
 */
export function startUI(state: AppState): void {
  const terminal = new ProcessTerminal();
  const inputController = createInputController(state);
  cel.init(terminal);

  cel.viewport(() => {
    const cols = terminal.columns;

    const base = VStack(
      {
        height: "100%",
        onKeyPress: (key) => {
          if (key === "ctrl+c") {
            gracefulExit(state).catch(() => process.exit(1));
            return;
          }
          if (key === "ctrl+d" && inputValue === "") {
            gracefulExit(state).catch(() => process.exit(1));
            return;
          }
          if (key === "escape" && state.running) {
            if (state.abortController) state.abortController.abort();
            return;
          }
          return false;
        },
      },
      [
        // ── Conversation log ──
        VStack(
          {
            flex: 1,
            overflow: "scroll",
            scrollbar: true,
            scrollOffset: stickToBottom ? Infinity : scrollOffset,
            onScroll: (offset, maxOffset) => {
              scrollOffset = offset;
              stickToBottom = offset >= maxOffset;
              cel.render();
            },
          },
          buildConversationLog(state),
        ),

        // ── Animated divider (pulse when agent is working) ──
        renderDivider(state, cols),

        // ── Input area ──
        renderInputArea(state.theme, inputController),

        // ── Static divider ──
        Divider({ fgColor: state.theme.divider }),

        // ── Status bar (2 lines) ──
        renderStatusBar(state),
      ],
    );

    if (activeOverlay) {
      return [base, renderOverlay(state)];
    }
    return base;
  });
}
