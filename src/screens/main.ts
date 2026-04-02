import { type App, ui } from "@rezi-ui/core";
import { dispatch } from "../helpers/actions";
import type { State } from "../types";

export function mainScreen(app: App<State>) {
  return (state: State) => {
    return ui.page({
      p: 1,
      gap: 1,
      body: ui.column({
        scrollbarVariant: "modern",
        overflow: "scroll",
      }, state.messages.map(m => {
        return ui.column({ gap: 0 }, [
          ...m.text.split("\n").map(l => ui.text(l, {wrap: true}))
        ])
      })),

      footer: ui.focusTrap(
        {
          id: "userInputArea",
          active: true,
          initialFocus: "userPromptEditor",
        },
        [
          ui.textarea({
            id: "userPromptEditor",
            value: state.userPrompt,
            placeholder: "Write a task for mini-coder...",
            focusConfig: { indicator: "none" },
            rows: 3,
            wordWrap: true,
            style: {},
            onInput: (value) => {
              dispatch(app, {
                type: "updateUserPrompt",
                text: value,
              });
            },
          }),
        ],
      ),
    });
  };
}
