/**
 * Input parsing, message submission, and streaming agent-event handling for the terminal UI.
 *
 * This module builds the controller used by `ui.ts`. Each controller owns its
 * own transient streaming render state for the in-progress assistant response.
 * Persistent session and message state remain on {@link AppState}; transient UI
 * concerns are exposed through runtime hooks so `ui.ts` can stay a small
 * orchestrator.
 *
 * @module
 */

import type { AssistantMessage } from "@mariozechner/pi-ai";
import type { AgentEvent } from "../agent.ts";
import { getErrorMessage } from "../errors.ts";
import type { AppState } from "../index.ts";
import {
  queueResolvedInput,
  resolveRawInput,
  submitResolvedInput,
} from "../submit.ts";
import type {
  PendingToolResult,
  StreamingConversationState,
} from "./conversation.ts";

export { isEmptyUserContent, stripSkillFrontmatter } from "../submit.ts";

interface UiAgentRuntimeState {
  /** Whether a response is currently streaming. */
  isStreaming: boolean;
  /** Streaming assistant content for the current response. */
  content: AssistantMessage["content"];
  /** Tool results collected during the current streaming turn. */
  pendingToolResults: PendingToolResult[];
}

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
  /** Read the current streaming tail state for conversation rendering. */
  getStreamingConversationState: () => StreamingConversationState;
  /** Reset the transient streaming state owned by this controller. */
  reset: () => void;
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
  const streamingState: UiAgentRuntimeState = {
    isStreaming: false,
    content: [],
    pendingToolResults: [],
  };

  const resetStreamingState = (): void => {
    streamingState.isStreaming = false;
    streamingState.content = [];
    streamingState.pendingToolResults = [];
  };

  const handleAgentEvent = (event: AgentEvent, _state: AppState): void => {
    switch (event.type) {
      case "text_delta":
      case "thinking_delta":
      case "toolcall_start":
      case "toolcall_delta":
      case "toolcall_end":
        streamingState.content = event.content;
        runtime.render();
        break;

      case "user_message":
        runtime.scrollConversationToBottom();
        runtime.render();
        break;

      case "assistant_message":
        streamingState.content = [];
        runtime.render();
        break;

      case "tool_start":
        break;

      case "tool_delta":
      case "tool_end": {
        const pending = streamingState.pendingToolResults.find(
          (toolResult) => toolResult.toolCallId === event.toolCallId,
        );
        if (pending) {
          pending.toolName = event.name;
          pending.content = event.result.content;
          pending.isError = event.result.isError;
        } else {
          streamingState.pendingToolResults.push({
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
        streamingState.pendingToolResults =
          streamingState.pendingToolResults.filter(
            (toolResult) => toolResult.toolCallId !== event.message.toolCallId,
          );
        runtime.render();
        break;

      case "done":
      case "error":
      case "aborted":
        resetStreamingState();
        runtime.render();
        break;
    }
  };

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

    if (state.running) {
      queueResolvedInput(rawInput, resolved.content, state);
      return;
    }

    if (!state.model) {
      return;
    }

    let submitPromise: Promise<void>;
    submitPromise = submitResolvedInput(rawInput, resolved.content, state, {
      onUserMessage: () => {
        runtime.scrollConversationToBottom();
        runtime.render();
      },
      onTurnStart: () => {
        resetStreamingState();
        streamingState.isStreaming = true;
        runtime.startDividerAnimation();
        runtime.render();
      },
      onEvent: (event, currentState) => handleAgentEvent(event, currentState),
      onTurnEnd: () => {
        resetStreamingState();
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

  return {
    handleInput: (raw, state) => {
      submitMessageAsync(raw, state);
    },
    getStreamingConversationState: () => streamingState,
    reset: resetStreamingState,
  };
}
