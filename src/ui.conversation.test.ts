import { describe, expect, test } from "bun:test";
import type { Node } from "@cel-tui/types";
import { DEFAULT_THEME, type Theme } from "./theme.ts";
import {
  previewToolRenderLines,
  renderToolResult,
  type ToolRenderLine,
} from "./ui/conversation.ts";

const RENDER_OPTS = {
  showReasoning: false,
  verbose: false,
  theme: DEFAULT_THEME,
};

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

function findTextNode(node: Node | null, content: string): Node | null {
  if (!node) {
    return null;
  }
  if (node.type === "text") {
    return node.content === content ? node : null;
  }
  if (node.type === "textinput") {
    return null;
  }
  for (const child of node.children) {
    const found = findTextNode(child, content);
    if (found) {
      return found;
    }
  }
  return null;
}

describe("ui/conversation", () => {
  test("previewToolRenderLines keeps all lines in verbose mode", () => {
    const lines: ToolRenderLine[] = Array.from({ length: 25 }, (_, i) => ({
      kind: "text",
      text: `line ${i + 1}`,
    }));

    const preview = previewToolRenderLines(lines, true, 20);

    expect(preview).toEqual(lines);
  });

  test("previewToolRenderLines shows first 20 lines plus a summary when verbose mode is off", () => {
    const lines: ToolRenderLine[] = Array.from({ length: 25 }, (_, i) => ({
      kind: "text",
      text: `line ${i + 1}`,
    }));

    const preview = previewToolRenderLines(lines, false, 20);

    expect(preview).toHaveLength(21);
    expect(preview.at(0)?.text).toBe("line 1");
    expect(preview.at(19)?.text).toBe("line 20");
    expect(preview.at(20)).toEqual({
      kind: "summary",
      text: "And 5 lines more",
    });
  });

  test("renderToolResult uses themed accent colors for tool headers", () => {
    const theme: Theme = {
      ...DEFAULT_THEME,
      accentText: "color04",
      secondaryAccentText: "color05",
    };

    const shellNode = renderToolResult(
      "shell",
      { command: "seq 1 3" },
      "1\n2\n3",
      false,
      { ...RENDER_OPTS, theme },
    );
    const shellHeader = findTextNode(shellNode, "$ seq 1 3");
    expect(shellHeader).not.toBeNull();
    if (!shellHeader || shellHeader.type !== "text") {
      throw new Error("Expected shell header to be a text node");
    }
    expect(shellHeader.props.fgColor).toBe(theme.accentText);

    const pluginNode = renderToolResult("plugin-tool", {}, "ok", false, {
      ...RENDER_OPTS,
      theme,
    });
    const pluginHeader = findTextNode(pluginNode, "plugin-tool");
    expect(pluginHeader).not.toBeNull();
    if (!pluginHeader || pluginHeader.type !== "text") {
      throw new Error("Expected plugin header to be a text node");
    }
    expect(pluginHeader.props.fgColor).toBe(theme.secondaryAccentText);
  });

  test("renderToolResult truncates shell output in non-verbose mode", () => {
    const output = Array.from({ length: 25 }, (_, i) => `line ${i + 1}`).join(
      "\n",
    );

    const node = renderToolResult(
      "shell",
      { command: "seq 1 25" },
      output,
      false,
      RENDER_OPTS,
    );
    const text = collectText(node);

    expect(text).toContain("$ seq 1 25");
    expect(text).toContain("line 1");
    expect(text).toContain("line 20");
    expect(text).toContain("And 5 lines more");
    expect(text).not.toContain("line 21");
  });

  test("renderToolResult shows full edit diffs in verbose mode", () => {
    const oldText = Array.from({ length: 25 }, (_, i) => `old ${i + 1}`).join(
      "\n",
    );
    const newText = Array.from({ length: 25 }, (_, i) => `new ${i + 1}`).join(
      "\n",
    );

    const node = renderToolResult(
      "edit",
      { path: "src/file.ts", oldText, newText },
      "Edited src/file.ts",
      false,
      { ...RENDER_OPTS, verbose: true },
    );
    const text = collectText(node);

    expect(text).toContain("+new 25");
    expect(text.some((line) => /^And \d+ lines more$/.test(line))).toBe(false);
  });
});
