import { cel, HStack, Text, TextInput, VStack } from "@cel-tui/core";
import { TextPill, theme } from "./tui-components";
import type { TUIState } from "./types";

function onOverlayKeyPress(state: TUIState) {
  return (key: string) => {
    if (key === "escape" || key === "ctrl+p") {
      state.overlay = false;
    }
  };
}

function onChange() {}
function onEditorKeyPress(_key: string) {}

export function SelectEditor(value: string) {
  let isEditorFocused = true;
  return TextInput({
    value,
    minHeight: 3,
    maxHeight: 10,
    padding: { x: 1 },
    placeholder: Text("Search...", { fgColor: theme.bblack, italic: true }),
    fgColor: theme.bblack,
    bgColor: theme.white,
    onChange,
    onKeyPress: onEditorKeyPress,
    // TODO: Update `cel-tui` with an autofocus prop to fix this pattern
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

export function SelectOverlay(state: TUIState, filter: string, list: string[]) {
  return VStack(
    {
      height: "100%",
      justifyContent: "end",
      onKeyPress: onOverlayKeyPress(state),
    },
    [
      VStack(
        {
          bgColor: theme.white,
          fgColor: theme.bblack,
          gap: 1,
          padding: { x: 1, y: 1 },
        },
        [
          VStack(
            { flex: 1, minHeight: 5, maxHeight: 20, padding: {x: 1} },
            list.map((i) => {
              return Text(i);
            }),
          ), // list
          HStack({ width: "100%" }, [
            TextPill("SELECT", theme.bwhite, theme.bblack),
          ]),
          SelectEditor(filter),
        ],
      ),
    ],
  );
}
