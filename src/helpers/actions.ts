import type { App } from "@rezi-ui/core";
import type { Action, State } from "../types";

export const initialState: State = {
  id: crypto.randomUUID(),
  userPrompt: "",
  messages: [],
};

export function dispatch(app: App<State>, action: Action) {
  app.update((s) => reduce(s, action));
}

export function reduce(state: State, action: Action): State {
  switch (action.type) {
    case "addMessage":
      return {
        ...state,
        userPrompt: "",
        messages: [...state.messages, action.message],
      };
    case "updateUserPrompt":
      return { ...state, userPrompt: action.text };
  }
}
