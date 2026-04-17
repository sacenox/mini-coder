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

interface UiRuntimeHooks {
  /** Trigger a UI render. */
  render: () => void;
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
  runtime.render();
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
