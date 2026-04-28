import { cel, Text, TextInput } from "@cel-tui/core";
import type { TUIState } from "./types";

export function Editor(
  state: TUIState,
  onChange: (value: string) => void,
  onKeyPress: (key: string) => void,
) {
  let isEditorFocused = !state.overlay;
  return TextInput({
    value: state.prompt,
    minHeight: 3,
    maxHeight: 10,
    padding: { x: 1 },
    placeholder: Text("Message...", { italic: true }),
    onChange,
    onKeyPress,
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
