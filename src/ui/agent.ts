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
import type { UiRenderPriority } from "./runtime.ts";

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
  /** Schedule a UI render. */
  requestRender: (priority?: UiRenderPriority) => void;
  /** Re-enable stick-to-bottom behavior for the conversation log. */
  scrollConversationToBottom: () => void;
  /** Clear the readonly queued-input draft after it is committed. */
  clearQueuedInputDraft: () => void;
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

  const resetStreamingState = (): boolean => {
    const changed =
      streamingState.isStreaming ||
      streamingState.content.length > 0 ||
      streamingState.pendingToolResults.length > 0;
    streamingState.isStreaming = false;
    streamingState.content = [];
    streamingState.pendingToolResults = [];
    return changed;
  };

  const clearStreamingContent = (): boolean => {
    if (streamingState.content.length === 0) {
      return false;
    }
    streamingState.content = [];
    return true;
  };

  const setStreamingContent = (
    content: AssistantMessage["content"],
  ): boolean => {
    if (streamingState.content === content) {
      return false;
    }
    streamingState.content = content;
    return true;
  };

  const upsertPendingToolResult = (
    event: Extract<AgentEvent, { type: "tool_delta" | "tool_end" }>,
  ): boolean => {
    const pending = streamingState.pendingToolResults.find(
      (toolResult) => toolResult.toolCallId === event.toolCallId,
    );
    if (pending) {
      if (
        pending.toolName === event.name &&
        pending.content === event.result.content &&
        pending.details === event.result.details &&
        pending.isError === event.result.isError
      ) {
        return false;
      }
      pending.toolName = event.name;
      pending.content = event.result.content;
      pending.details = event.result.details;
      pending.isError = event.result.isError;
      return true;
    }

    streamingState.pendingToolResults.push({
      toolCallId: event.toolCallId,
      toolName: event.name,
      content: event.result.content,
      details: event.result.details,
      isError: event.result.isError,
    });
    return true;
  };

  const removePendingToolResult = (toolCallId: string): boolean => {
    const nextPendingToolResults = streamingState.pendingToolResults.filter(
      (toolResult) => toolResult.toolCallId !== toolCallId,
    );
    if (
      nextPendingToolResults.length === streamingState.pendingToolResults.length
    ) {
      return false;
    }
    streamingState.pendingToolResults = nextPendingToolResults;
    return true;
  };

  const isStreamingContentEvent = (
    event: AgentEvent,
  ): event is Extract<
    AgentEvent,
    {
      type:
        | "text_delta"
        | "thinking_delta"
        | "toolcall_start"
        | "toolcall_delta"
        | "toolcall_end";
    }
  > => {
    return (
      event.type === "text_delta" ||
      event.type === "thinking_delta" ||
      event.type === "toolcall_start" ||
      event.type === "toolcall_delta" ||
      event.type === "toolcall_end"
    );
  };

  const isPendingToolProgressEvent = (
    event: AgentEvent,
  ): event is Extract<AgentEvent, { type: "tool_delta" | "tool_end" }> => {
    return event.type === "tool_delta" || event.type === "tool_end";
  };

  const handleCommittedAgentEvent = (
    event: Exclude<
      AgentEvent,
      | Extract<
          AgentEvent,
          {
            type:
              | "text_delta"
              | "thinking_delta"
              | "toolcall_start"
              | "toolcall_delta"
              | "toolcall_end";
          }
        >
      | Extract<AgentEvent, { type: "tool_delta" | "tool_end" }>
    >,
  ): void => {
    switch (event.type) {
      case "user_message":
        runtime.clearQueuedInputDraft();
        runtime.scrollConversationToBottom();
        runtime.requestRender("normal");
        return;
      case "assistant_message":
        if (clearStreamingContent()) {
          runtime.requestRender("normal");
        }
        return;
      case "tool_result":
        if (removePendingToolResult(event.message.toolCallId)) {
          runtime.requestRender("normal");
        }
        return;
      case "done":
      case "error":
      case "aborted":
        if (resetStreamingState()) {
          runtime.requestRender("normal");
        }
        return;
      case "tool_start":
        return;
    }
  };

  const handleAgentEvent = (event: AgentEvent, _state: AppState): void => {
    if (isStreamingContentEvent(event)) {
      if (setStreamingContent(event.content)) {
        runtime.requestRender("stream");
      }
      return;
    }

    if (isPendingToolProgressEvent(event)) {
      if (upsertPendingToolResult(event)) {
        runtime.requestRender("stream");
      }
      return;
    }

    handleCommittedAgentEvent(event);
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
        runtime.requestRender("normal");
      },
      onTurnStart: () => {
        resetStreamingState();
        streamingState.isStreaming = true;
        runtime.startDividerAnimation();
        runtime.requestRender("normal");
      },
      onEvent: (event, currentState) => handleAgentEvent(event, currentState),
      onTurnEnd: () => {
        resetStreamingState();
        runtime.clearQueuedInputDraft();
        runtime.stopDividerAnimation();
        runtime.requestRender("normal");
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
