import * as c from "yoctocolors";
import { createHighlighter, type Highlighter } from "yoctomarkdown";

import { buildAbortMessages, isAbortError } from "../agent/agent-helpers.ts";
import type { CoreMessage } from "../llm-api/turn.ts";
import type { TurnEvent } from "../llm-api/types.ts";

import { G, RenderedError, renderError, write, writeln } from "./output.ts";
import {
  normalizeReasoningDelta,
  normalizeReasoningText,
} from "./reasoning.ts";
import type { Spinner } from "./spinner.ts";
import { terminal } from "./terminal-io.ts";
import {
  buildToolCallLine,
  renderToolCall,
  renderToolResult,
} from "./tool-render.ts";

// ─── Inline reasoning rendering ──────────────────────────────────────────────

function styleReasoning(text: string): string {
  return c.italic(c.dim(text));
}

function writeReasoningDelta(
  delta: string,
  state: { blockOpen: boolean; lineOpen: boolean },
): void {
  if (!delta) return;
  if (!state.blockOpen) {
    writeln(`${G.info} ${c.dim("reasoning")}`);
    state.blockOpen = true;
  }
  const lines = delta.split("\n");
  for (const [i, line] of lines.entries()) {
    if (line) {
      if (!state.lineOpen) {
        write("  ");
        state.lineOpen = true;
      }
      write(styleReasoning(line));
    }
    if (i < lines.length - 1) {
      if (!state.lineOpen) write("  ");
      writeln();
      state.lineOpen = false;
    }
  }
}

function finishReasoning(state: {
  blockOpen: boolean;
  lineOpen: boolean;
}): void {
  if (!state.blockOpen) return;
  if (state.lineOpen) writeln();
  state.blockOpen = false;
  state.lineOpen = false;
}

// ─── Inline text streaming ───────────────────────────────────────────────────

function appendTextDelta(
  delta: string | undefined,
  state: {
    inText: boolean;
    text: string;
    highlighter: Highlighter | undefined;
  },
  spinner: Spinner,
  quiet: boolean,
  renderedVisibleOutput: boolean,
): boolean {
  let chunk = delta ?? "";
  if (!chunk) return state.inText;
  if (!state.inText) {
    chunk = chunk.trimStart();
    if (!chunk) return false;
    if (!quiet) {
      spinner.stop();
      if (renderedVisibleOutput) writeln();
      write(`${G.reply} `);
    }
    state.inText = true;
    if (!quiet && terminal.isStdoutTTY) {
      state.highlighter = createHighlighter();
    }
  }
  const isFirstLine = !state.text.includes("\n");
  state.text += chunk;
  if (quiet) return state.inText;
  spinner.stop();
  if (state.highlighter) {
    let colored = state.highlighter.write(chunk);
    if (colored) {
      if (isFirstLine && colored.startsWith("\x1b[2K\r")) {
        colored = `\x1b[2K\r${G.reply} ${colored.slice(5)}`;
      }
      write(colored);
    }
  } else {
    write(chunk);
  }
  return state.inText;
}

function flushText(
  state: {
    inText: boolean;
    text: string;
    highlighter: Highlighter | undefined;
  },
  quiet: boolean,
): void {
  if (!state.inText) return;
  if (!quiet) {
    if (state.highlighter) {
      let finalColored = state.highlighter.end();
      if (finalColored) {
        const isFirstLine = !state.text.includes("\n");
        if (isFirstLine && finalColored.startsWith("\x1b[2K\r")) {
          finalColored = `\x1b[2K\r${G.reply} ${finalColored.slice(5)}`;
        }
        write(finalColored);
      }
    }
    writeln();
  }
  state.inText = false;
}

// ─── Main render loop ────────────────────────────────────────────────────────

export async function renderTurn(
  events: AsyncIterable<TurnEvent>,
  spinner: Spinner,
  opts?: { showReasoning?: boolean; verboseOutput?: boolean; quiet?: boolean },
): Promise<{
  inputTokens: number;
  outputTokens: number;
  contextTokens: number;
  newMessages: CoreMessage[];
  reasoningText: string;
}> {
  const quiet = opts?.quiet ?? false;
  const showReasoning = !quiet && (opts?.showReasoning ?? true);
  const verboseOutput = opts?.verboseOutput ?? false;

  // Text state
  const textState = {
    inText: false,
    text: "",
    highlighter: undefined as Highlighter | undefined,
  };

  // Reasoning state
  let reasoningRaw = "";
  let reasoningComputed = false;
  let reasoningText = "";
  const reasoningState = { blockOpen: false, lineOpen: false };

  // Tool state
  const startedToolCalls = new Set<string>();
  const toolCallInfo = new Map<string, { toolName: string; label: string }>();
  let parallelCallCount = 0;

  // Output tracking
  let inputTokens = 0;
  let outputTokens = 0;
  let contextTokens = 0;
  let newMessages: CoreMessage[] = [];
  let renderedVisibleOutput = false;

  const getReasoningText = (): string => {
    if (!reasoningComputed) {
      reasoningText = normalizeReasoningText(reasoningRaw);
      reasoningComputed = true;
    }
    return reasoningText;
  };

  for await (const event of events) {
    switch (event.type) {
      case "text-delta": {
        finishReasoning(reasoningState);
        textState.inText = appendTextDelta(
          event.delta,
          textState,
          spinner,
          quiet,
          renderedVisibleOutput,
        );
        if (textState.inText) renderedVisibleOutput = true;
        break;
      }

      case "reasoning-delta": {
        flushText(textState, quiet);
        let appended = normalizeReasoningDelta(event.delta);
        if (
          reasoningRaw.endsWith("**") &&
          appended.startsWith("**") &&
          !reasoningRaw.endsWith("\n")
        ) {
          appended = `\n${appended}`;
        }
        reasoningRaw += appended;
        reasoningComputed = false;
        if (showReasoning && appended) {
          spinner.stop();
          if (renderedVisibleOutput && !reasoningState.blockOpen) writeln();
          writeReasoningDelta(appended, reasoningState);
          renderedVisibleOutput = true;
        }
        break;
      }

      case "tool-input-delta": {
        if (quiet) break;
        finishReasoning(reasoningState);
        flushText(textState, quiet);
        spinner.start(`composing ${event.toolName}…`);
        break;
      }

      case "tool-call-start": {
        if (startedToolCalls.has(event.toolCallId)) break;
        const isConsecutiveToolCall =
          startedToolCalls.size > 0 && toolCallInfo.size > 0;
        startedToolCalls.add(event.toolCallId);
        toolCallInfo.set(event.toolCallId, {
          toolName: event.toolName,
          label: buildToolCallLine(event.toolName, event.args),
        });
        if (toolCallInfo.size > 1) {
          parallelCallCount = toolCallInfo.size;
        }
        finishReasoning(reasoningState);
        flushText(textState, quiet);
        if (!quiet) {
          spinner.stop();
          if (renderedVisibleOutput && !isConsecutiveToolCall) {
            writeln();
          }
          renderToolCall(event.toolName, event.args, { verboseOutput });
          renderedVisibleOutput = true;
          spinner.start(event.toolName);
        }
        break;
      }

      case "tool-result": {
        startedToolCalls.delete(event.toolCallId);
        const callInfo = toolCallInfo.get(event.toolCallId);
        toolCallInfo.delete(event.toolCallId);
        finishReasoning(reasoningState);
        if (!quiet) {
          spinner.stop();
          if (parallelCallCount > 1 && callInfo) {
            writeln(`${c.dim("↳")} ${callInfo.label}`);
          }
          if (toolCallInfo.size === 0) parallelCallCount = 0;
          renderToolResult(event.toolName, event.result, event.isError, {
            verboseOutput,
          });
          renderedVisibleOutput = true;
          spinner.start("thinking");
        } else {
          if (toolCallInfo.size === 0) parallelCallCount = 0;
        }
        break;
      }

      case "context-pruned": {
        finishReasoning(reasoningState);
        flushText(textState, quiet);
        if (!quiet) {
          spinner.stop();
          const removedKb = (event.removedBytes / 1024).toFixed(1);
          writeln(
            `${G.info} ${c.dim("context pruned")}  ${c.dim(`–${event.removedMessageCount} messages`)}  ${c.dim(`–${removedKb} KB`)}`,
          );
          renderedVisibleOutput = true;
          spinner.start("thinking");
        }
        break;
      }

      case "turn-complete": {
        finishReasoning(reasoningState);
        flushText(textState, quiet);
        spinner.stop();
        if (!quiet && !renderedVisibleOutput) writeln();
        inputTokens = event.inputTokens;
        outputTokens = event.outputTokens;
        contextTokens = event.contextTokens;
        newMessages = event.messages;
        break;
      }

      case "turn-error": {
        finishReasoning(reasoningState);
        flushText(textState, quiet);
        spinner.stop();
        inputTokens = event.inputTokens;
        outputTokens = event.outputTokens;
        contextTokens = event.contextTokens;
        if (isAbortError(event.error)) {
          newMessages = buildAbortMessages(
            event.partialMessages,
            textState.text,
          );
        } else {
          renderError(event.error, "turn");
          throw new RenderedError(event.error);
        }
        break;
      }
    }
  }

  return {
    inputTokens,
    outputTokens,
    contextTokens,
    newMessages,
    reasoningText: getReasoningText(),
  };
}
