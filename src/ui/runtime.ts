/**
 * Runtime-only helper bindings for the terminal UI.
 *
 * @module
 */

import type { AppState } from "../index.ts";
import {
  appendConversationMessage,
  appendMessage,
  createUiMessage,
  createUiTodoMessage,
  type UiInfoFormat,
  type UiMessage,
} from "../session.ts";
import type { TodoItem } from "../tools.ts";

/** Render scheduling priorities used by the terminal UI. */
export type UiRenderPriority = "immediate" | "normal" | "stream" | "animation";

interface UiRuntimeHooks {
  /** Schedule a UI render. */
  requestRender: (priority?: UiRenderPriority) => void;
  /** Re-enable stick-to-bottom behavior for the conversation log. */
  scrollConversationToBottom: () => void;
}

interface UiRuntimeHelpers {
  /** Append a UI-only info message to the conversation log. */
  appendInfoMessage: (
    text: string,
    state: AppState,
    format?: UiInfoFormat,
  ) => void;
  /** Append a UI-only todo snapshot to the conversation log. */
  appendTodoMessage: (todos: readonly TodoItem[], state: AppState) => void;
}

function appendUiMessage(
  message: UiMessage,
  state: AppState,
  runtime: UiRuntimeHooks,
): void {
  if (state.session) {
    appendMessage(state.db, state.session.id, message);
  }
  appendConversationMessage(state, message);
  runtime.scrollConversationToBottom();
  runtime.requestRender("normal");
}

/**
 * Create runtime-bound helpers that append UI-only conversation messages.
 *
 * @param runtime - Render and scroll hooks owned by `ui.ts`.
 * @returns Helpers shared by the command and agent controllers.
 */
export function createUiRuntimeHelpers(
  runtime: UiRuntimeHooks,
): UiRuntimeHelpers {
  return {
    appendInfoMessage: (text, state, format) => {
      appendUiMessage(createUiMessage(text, format), state, runtime);
    },
    appendTodoMessage: (todos, state) => {
      appendUiMessage(createUiTodoMessage(todos), state, runtime);
    },
  };
}
