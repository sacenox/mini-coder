import { describe, expect, test } from "bun:test";
import { Select } from "@cel-tui/components";
import { DEFAULT_THEME } from "./theme.ts";
import {
  type ActiveOverlay,
  OVERLAY_MAX_VISIBLE,
  OVERLAY_PADDING_X,
  renderOverlay,
} from "./ui/overlay.ts";

describe("ui/overlay", () => {
  test("renderOverlay centers a titled modal with theme background", () => {
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

    const node = renderOverlay(DEFAULT_THEME, overlay);

    expect(node.type).toBe("vstack");
    if (node.type !== "vstack") {
      throw new Error("Expected overlay root to be a VStack");
    }

    expect(node.props.height).toBe("100%");
    expect(node.props.justifyContent).toBe("center");
    expect(node.props.padding).toEqual({ x: OVERLAY_PADDING_X });

    const modal = node.children[0];
    expect(modal?.type).toBe("vstack");
    if (!modal || modal.type !== "vstack") {
      throw new Error("Expected overlay modal to be a VStack");
    }

    expect(modal.props.height).toBe(OVERLAY_MAX_VISIBLE + 3);
    expect(modal.props.bgColor).toBe(DEFAULT_THEME.overlayBg);
    expect(modal.props.padding).toEqual({ x: 1 });
    expect(modal.children[0]?.type).toBe("text");
    expect(modal.children[1]?.type).toBe("vstack");
  });
});
