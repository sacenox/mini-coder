/**
 * Input parsing, message submission, and streaming agent-event handling for the terminal UI.
 *
 * This module owns the transient streaming render state for the in-progress
 * assistant response. Persistent session and message state remain on
 * {@link AppState}; transient UI concerns are exposed through runtime hooks so
 * `ui.ts` can stay a small orchestrator.
 *
 * @module
 */

import type { AssistantMessage } from "@mariozechner/pi-ai";
import type { AgentEvent } from "../agent.ts";
import { getErrorMessage } from "../errors.ts";
import type { AppState } from "../index.ts";
import { resolveRawInput, submitResolvedInput } from "../submit.ts";
import type {
  PendingToolResult,
  StreamingConversationState,
} from "./conversation.ts";

export { isEmptyUserContent, stripSkillFrontmatter } from "../submit.ts";

/** Streaming assistant content for the current response. */
let streamingContent: AssistantMessage["content"] = [];

/** Whether a response is currently streaming. */
let isStreaming = false;

/** Tool results collected during the current streaming turn. */
let pendingToolResults: PendingToolResult[] = [];

/** Hooks implemented by `ui.ts` to bridge controller logic with runtime UI state. */
interface UiAgentRuntime {
  /** Append a UI-only informational message to the conversation log. */
  appendInfoMessage: (text: string, state: AppState) => void;
  /** Dispatch a parsed slash command. */
  handleCommand: (command: string, state: AppState) => boolean;
  /** Trigger a UI render. */
  render: () => void;
  /** Re-enable stick-to-bottom behavior for the conversation log. */
  scrollConversationToBottom: () => void;
  /** Start the active-turn divider animation. */
  startDividerAnimation: () => void;
  /** Stop the active-turn divider animation. */
  stopDividerAnimation: () => void;
}

/** Public controller API for raw input dispatch and streaming state. */
interface UiAgentController {
  /** Route raw user input through parseInput and dispatch accordingly. */
  handleInput: (raw: string, state: AppState) => void;
}

/**
 * Reset the transient streaming UI state owned by this module.
 *
 * Used by `resetUiState()` and tests to keep state isolated.
 */
export function resetUiAgentState(): void {
  streamingContent = [];
  isStreaming = false;
  pendingToolResults = [];
}

/**
 * Read the current streaming tail state for conversation rendering.
 *
 * @returns The in-progress assistant content and pending tool results.
 */
export function getStreamingConversationState(): StreamingConversationState {
  return {
    isStreaming,
    content: streamingContent,
    pendingToolResults,
  };
}

/**
 * Create the UI agent controller bound to runtime hooks supplied by `ui.ts`.
 *
 * @param runtime - Runtime hooks for rendering, scrolling, and command feedback.
 * @returns The controller used by the input layer and tests.
 */
export function createUiAgentController(
  runtime: UiAgentRuntime,
): UiAgentController {
  const submitMessageAsync = (rawInput: string, state: AppState): void => {
    const resolved = resolveRawInput(rawInput, state);

    switch (resolved.type) {
      case "empty":
        return;
      case "error":
        runtime.appendInfoMessage(resolved.message, state);
        return;
      case "command":
        if (!runtime.handleCommand(resolved.command, state)) {
          // Unimplemented command — ignore for now
        }
        return;
      case "message":
        break;
    }

    if (!state.model || state.running) {
      return;
    }

    let submitPromise: Promise<void>;
    submitPromise = submitResolvedInput(rawInput, resolved.content, state, {
      onUserMessage: () => {
        runtime.scrollConversationToBottom();
        runtime.render();
      },
      onTurnStart: () => {
        isStreaming = true;
        streamingContent = [];
        pendingToolResults = [];
        runtime.startDividerAnimation();
        runtime.render();
      },
      onEvent: (event, currentState) => handleAgentEvent(event, currentState),
      onTurnEnd: () => {
        resetUiAgentState();
        runtime.stopDividerAnimation();
        runtime.render();
      },
    })
      .then(() => undefined)
      .catch((err) => {
        runtime.appendInfoMessage(
          `Submit failed: ${getErrorMessage(err)}`,
          state,
        );
      })
      .finally(() => {
        if (state.activeTurnPromise === submitPromise) {
          state.activeTurnPromise = null;
        }
      });

    state.activeTurnPromise = submitPromise;
  };

  const handleAgentEvent = (event: AgentEvent, _state: AppState): void => {
    switch (event.type) {
      case "text_delta":
      case "thinking_delta":
      case "toolcall_start":
      case "toolcall_delta":
      case "toolcall_end":
        streamingContent = event.content;
        runtime.render();
        break;

      case "assistant_message":
        streamingContent = [];
        runtime.render();
        break;

      case "tool_start":
        break;

      case "tool_delta":
      case "tool_end": {
        const pending = pendingToolResults.find(
          (toolResult) => toolResult.toolCallId === event.toolCallId,
        );
        if (pending) {
          pending.toolName = event.name;
          pending.content = event.result.content;
          pending.isError = event.result.isError;
        } else {
          pendingToolResults.push({
            toolCallId: event.toolCallId,
            toolName: event.name,
            content: event.result.content,
            isError: event.result.isError,
          });
        }
        runtime.render();
        break;
      }

      case "tool_result":
        pendingToolResults = pendingToolResults.filter(
          (toolResult) => toolResult.toolCallId !== event.message.toolCallId,
        );
        runtime.render();
        break;

      case "done":
      case "error":
      case "aborted":
        resetUiAgentState();
        runtime.render();
        break;
    }
  };

  const handleInput = (raw: string, state: AppState): void => {
    submitMessageAsync(raw, state);
  };

  return { handleInput };
}
