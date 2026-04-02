import type { App } from "@rezi-ui/core";
import type { State } from "../types";
import { dispatch } from "./actions";

export function registerKeybindings(app: App<State>) {
  app.keys({
    "ctrl+c": () => app.stop(),
    enter: {
      when: (ctx) => ctx.focusedId === "userPromptEditor",
      handler: (ctx) => {
        dispatch(app, {
          type: "addMessage",
          message: { text: ctx.state.userPrompt, role: "user" },
        });
      },
      description: "Submit prompt",
    },
  });
}
