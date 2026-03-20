import * as c from "yoctocolors";
import { buildAbortMessages, isAbortError } from "../agent/agent-helpers.ts";
import type { CoreMessage } from "../llm-api/turn.ts";
import type { TurnEvent } from "../llm-api/types.ts";
import { LiveReasoningBlock } from "./live-reasoning.ts";
import { G, RenderedError, renderError, writeln } from "./output.ts";
import {
  normalizeReasoningDelta,
  normalizeReasoningText,
} from "./reasoning.ts";
import type { Spinner } from "./spinner.ts";
import { StreamRenderContent } from "./stream-render-content.ts";
import {
  buildToolCallLine,
  renderToolCall,
  renderToolResult,
} from "./tool-render.ts";

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
  const content = new StreamRenderContent(spinner, quiet);
  const liveReasoning = new LiveReasoningBlock();

  let inputTokens = 0;
  let outputTokens = 0;
  let contextTokens = 0;
  let newMessages: CoreMessage[] = [];
  const startedToolCalls = new Set<string>();
  const toolCallInfo = new Map<string, { toolName: string; label: string }>();
  let parallelCallCount = 0;
  let renderedVisibleOutput = false;

  let reasoningComputed = false;
  let reasoningText = "";
  const getReasoningText = (): string => {
    if (!reasoningComputed) {
      reasoningText = normalizeReasoningText(content.getReasoning());
      reasoningComputed = true;
    }
    return reasoningText;
  };

  for await (const event of events) {
    switch (event.type) {
      case "text-delta": {
        liveReasoning.finish();
        content.appendTextDelta(event.delta, renderedVisibleOutput);
        if (content.hasOpenContent()) renderedVisibleOutput = true;
        break;
      }
      case "reasoning-delta": {
        content.flushOpenContent();
        const delta = content.appendReasoningDelta(
          normalizeReasoningDelta(event.delta),
        );
        reasoningComputed = false;
        if (showReasoning && delta) {
          spinner.stop();
          if (renderedVisibleOutput && !liveReasoning.isOpen()) writeln();
          liveReasoning.append(delta);
          renderedVisibleOutput = true;
        }
        break;
      }

      case "tool-call-start": {
        if (startedToolCalls.has(event.toolCallId)) {
          break;
        }
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
        liveReasoning.finish();
        content.flushOpenContent();
        if (!quiet) {
          spinner.stop();
          if (renderedVisibleOutput && !isConsecutiveToolCall) writeln();
          renderToolCall(event.toolName, event.args);
          renderedVisibleOutput = true;
          spinner.start(event.toolName);
        }
        break;
      }

      case "tool-result": {
        startedToolCalls.delete(event.toolCallId);
        const callInfo = toolCallInfo.get(event.toolCallId);
        toolCallInfo.delete(event.toolCallId);
        liveReasoning.finish();
        if (!quiet) {
          spinner.stop();
          if (parallelCallCount > 1 && callInfo) {
            writeln(`    ${c.dim("↳")} ${callInfo.label}`);
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
        liveReasoning.finish();
        content.flushOpenContent();
        if (!quiet) {
          spinner.stop();
          const removedKb = (event.removedBytes / 1024).toFixed(1);
          writeln(
            `${G.info} ${c.dim("context pruned")}  ${c.dim(`–${event.removedMessageCount} messages`)}  ${c.dim(`–${removedKb} KB`)}`,
          );
          renderedVisibleOutput = true;
        }
        break;
      }

      case "turn-complete": {
        liveReasoning.finish();
        content.flushOpenContent();
        spinner.stop();
        if (!quiet && !renderedVisibleOutput) writeln();
        inputTokens = event.inputTokens;
        outputTokens = event.outputTokens;
        contextTokens = event.contextTokens;
        newMessages = event.messages;
        break;
      }

      case "turn-error": {
        liveReasoning.finish();
        content.flushOpenContent();
        spinner.stop();
        if (isAbortError(event.error)) {
          newMessages = buildAbortMessages(
            event.partialMessages,
            content.getText(),
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
