import { basename } from "node:path";
import type { Color } from "@cel-tui/core";
import {
  cel,
  HStack,
  ProcessTerminal,
  Text,
  TextInput,
  VStack,
} from "@cel-tui/core";
import type { TUIOptions } from "./types";

const theme = {
  black: "color00",
  bblack: "color08",

  red: "color01",
  bred: "color09",

  green: "color02",
  bgreen: "color10",

  yellow: "color03",
  byellow: "color11",

  blue: "color04",
  bblue: "color12",

  magenta: "color05",
  bmagenta: "color13",

  cyan: "color06",
  bcyan: "color14",

  white: "color07",
  bwhite: "color15",
};

// Examples:
//
// TextPill("mini-coder", theme.bblack as Color, theme.black as Color),
// TextPill("mini-coder", theme.bred as Color, theme.red as Color),
// TextPill("mini-coder", theme.bgreen as Color, theme.green as Color),
// TextPill("mini-coder", theme.byellow as Color, theme.yellow as Color),
// TextPill("mini-coder", theme.bblue as Color, theme.blue as Color),
// TextPill("mini-coder", theme.bmagenta as Color, theme.magenta as Color),
// TextPill("mini-coder", theme.bcyan as Color, theme.cyan as Color),
// TextPill("mini-coder", theme.bwhite as Color, theme.white as Color),
function TextPill(content: string, fgColor: Color, bgColor: Color) {
  return HStack({ gap: 1 }, [
    HStack({ bgColor, padding: { x: 1 } }, [
      Text(content, { bold: true, fgColor }),
    ]),
  ]);
}

function Editor(state: { prompt: string; messages: string[] }) {
  let isEditorFocused = true;
  return TextInput({
    value: state.prompt,
    minHeight: 3,
    maxHeight: 10,
    padding: { x: 1 },
    placeholder: Text("Message...", { italic: true }),
    onChange: (value: string) => {
      state.prompt = value;
      cel.render();
    },
    onKeyPress: (key: string) => {
      if (key === "enter") {
        state.messages.push(state.prompt);
        state.prompt = "";
        cel.render();
        return false;
      }
    },
    focused: isEditorFocused,
    onFocus: () => {
      isEditorFocused = true;
      cel.render();
    },
    onBlur: () => {
      isEditorFocused = false;
      cel.render();
    },
  });
}

export function initTUI({ onStop }: TUIOptions) {
  const cwd = basename(process.cwd());
  const state = {
    prompt: "",
    messages: [],
  };

  cel.init(new ProcessTerminal());
  cel.setTitle(`mc | ${cwd}`);

  cel.viewport(() =>
    VStack(
      {
        height: "100%",
        gap: 1,
        onKeyPress: (key) => {
          if (key === "ctrl+q" || key === "ctrl+c") {
            cel.stop();
            onStop();
          }
        },
      },
      [
        VStack({ flex: 1, gap: 1, overflow: "scroll" }, [
          ...state.messages.map((msg) => {
            return Text(msg, { wrap: "word" });
          }),
        ]),

        HStack({ gap: 1 }, [
          TextPill("mini-coder", theme.bblack as Color, theme.bwhite as Color),
          TextPill(cwd, theme.bwhite as Color, theme.bblack as Color),
        ]),

        Editor(state),
      ],
    ),
  );
}
