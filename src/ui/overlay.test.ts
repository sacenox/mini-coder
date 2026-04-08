import { describe, expect, test } from "bun:test";
import { Select } from "@cel-tui/components";
import type { Node } from "@cel-tui/types";
import { DEFAULT_THEME } from "../theme.ts";
import { type ActiveOverlay, renderOverlay } from "./overlay.ts";

function collectText(node: Node | null): string[] {
  if (!node) {
    return [];
  }
  if (node.type === "text") {
    return [node.content];
  }
  if (node.type === "textinput") {
    return [];
  }
  return node.children.flatMap((child) => collectText(child));
}

describe("ui/overlay", () => {
  test("renderOverlay shows the title above the selectable body", () => {
    const overlay: ActiveOverlay = {
      title: "Commands",
      select: Select({
        items: [{ label: "overlay body", value: "body", filterText: "body" }],
        maxVisible: 1,
        placeholder: "type to filter...",
        focused: true,
        highlightColor: DEFAULT_THEME.accentText,
        onSelect: () => {},
        onBlur: () => {},
      }),
    };

    const text = collectText(renderOverlay(DEFAULT_THEME, overlay));
    const titleIndex = text.indexOf("Commands");
    const bodyIndex = text.indexOf("overlay body");

    expect(titleIndex).toBeGreaterThanOrEqual(0);
    expect(bodyIndex).toBeGreaterThan(titleIndex);
  });
});
