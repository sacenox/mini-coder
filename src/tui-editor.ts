import { Text, TextInput } from "@cel-tui/core";
import type { TUIState } from "./types";

export function Editor(
  state: TUIState,
  onChange: (value: string) => void,
  onKeyPress: (key: string) => void,
) {
  return TextInput({
    stateKey: "prompt-input",
    value: state.prompt,
    minHeight: 3,
    maxHeight: 10,
    padding: { x: 1 },
    placeholder: Text("Message...", { italic: true }),
    onChange,
    onKeyPress,
    autoFocus: true,
  });
}
