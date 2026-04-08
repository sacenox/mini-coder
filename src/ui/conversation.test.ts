import { describe, expect, test } from "bun:test";
import type { Node } from "@cel-tui/types";
import {
  fauxAssistantMessage,
  fauxText,
  fauxThinking,
} from "@mariozechner/pi-ai";
import { DEFAULT_THEME, type Theme } from "../theme.ts";
import {
  type PendingToolCall,
  previewToolRenderLines,
  renderAssistantMessage,
  renderToolResult,
  type ToolRenderLine,
} from "./conversation.ts";

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
  test("renderAssistantMessage keeps streamed markdown inside one top-level container", () => {
    const message = fauxAssistantMessage("First paragraph\n\nSecond paragraph");

    const node = renderAssistantMessage(message, RENDER_OPTS);

    expect(node).not.toBeNull();
    expect(node?.type).toBe("vstack");
    if (!node || node.type !== "vstack") {
      throw new Error("Expected a vstack container");
    }
    expect(node.children.length).toBeGreaterThan(1);
  });

  test("renderAssistantMessage shows thinking blocks when reasoning is enabled", () => {
    const message = fauxAssistantMessage([
      fauxThinking("I should inspect the tests first."),
      fauxText("Done."),
    ]);

    const node = renderAssistantMessage(message, {
      ...RENDER_OPTS,
      showReasoning: true,
      theme: { ...DEFAULT_THEME, mutedText: "color03" },
    });
    const text = collectText(node);
    const thinkingNode = findTextNode(
      node,
      "I should inspect the tests first.",
    );

    expect(text).toContain("I should inspect the tests first.");
    expect(text).toContain("Done.");
    expect(thinkingNode).not.toBeNull();
    if (!thinkingNode || thinkingNode.type !== "text") {
      throw new Error("Expected thinking node to be a text node");
    }
    expect(thinkingNode.props.fgColor).toBe("color03");
  });

  test("renderAssistantMessage shows a thinking line-count placeholder when reasoning is hidden", () => {
    const message = fauxAssistantMessage([
      fauxThinking("line one\nline two\nline three"),
      fauxText("Done."),
    ]);

    const node = renderAssistantMessage(message, {
      ...RENDER_OPTS,
      showReasoning: false,
    });
    const text = collectText(node);

    expect(text).toContain("Thinking... 3 lines.");
    expect(text).toContain("Done.");
    expect(text).not.toContain("line one");
    expect(text).not.toContain("line two");
  });

  test("renderAssistantMessage keeps in-progress text and tool output inside one top-level container", () => {
    const pendingToolCalls: PendingToolCall[] = [
      {
        toolCallId: "tool-1",
        name: "shell",
        args: { command: "echo hi" },
        resultText: "hi",
        isError: false,
        done: true,
      },
    ];

    const node = renderAssistantMessage(
      {
        content: [fauxText("Working...")],
        pendingToolCalls,
      },
      RENDER_OPTS,
    );

    expect(node).not.toBeNull();
    expect(node?.type).toBe("vstack");
    if (!node || node.type !== "vstack") {
      throw new Error("Expected a vstack container");
    }
    expect(node.children.length).toBeGreaterThanOrEqual(2);
  });

  test("renderAssistantMessage shows in-progress thinking when reasoning is enabled", () => {
    const node = renderAssistantMessage(
      {
        content: [fauxThinking("Reasoning in progress")],
      },
      {
        ...RENDER_OPTS,
        showReasoning: true,
      },
    );
    const text = collectText(node);

    expect(text).toContain("Reasoning in progress");
  });

  test("renderAssistantMessage shows a 1-line thinking placeholder for in-progress content", () => {
    const node = renderAssistantMessage(
      {
        content: [fauxThinking("some thinking")],
      },
      {
        ...RENDER_OPTS,
        showReasoning: false,
      },
    );
    const text = collectText(node);

    expect(text).toContain("Thinking... 1 line.");
  });

  test("renderAssistantMessage shows partial tool output before the tool finishes", () => {
    const node = renderAssistantMessage(
      {
        content: [],
        pendingToolCalls: [
          {
            toolCallId: "tool-1",
            name: "shell",
            args: { command: "echo hi" },
            resultText: "partial output",
            isError: false,
            done: false,
          },
        ],
      },
      RENDER_OPTS,
    );
    const text = collectText(node);

    expect(text).toContain("$ echo hi");
    expect(text).toContain("partial output");
    expect(text).toContain("Running...");
  });

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

  test("renderToolResult shows full shell output in verbose mode", () => {
    const output = Array.from({ length: 25 }, (_, i) => `line ${i + 1}`).join(
      "\n",
    );

    const node = renderToolResult(
      "shell",
      { command: "seq 1 25" },
      output,
      false,
      { ...RENDER_OPTS, verbose: true },
    );
    const text = collectText(node);

    expect(text).toContain("line 25");
    expect(text).not.toContain("And 5 lines more");
  });

  test("renderToolResult shows shell exit codes", () => {
    const node = renderToolResult(
      "shell",
      { command: "exit 42" },
      "Exit code: 42\n[stderr]\nboom",
      true,
      RENDER_OPTS,
    );
    const text = collectText(node);

    expect(text).toContain("$ exit 42");
    expect(text).toContain("Exit code: 42");
  });

  test("renderToolResult shows a diff for newly created files", () => {
    const node = renderToolResult(
      "edit",
      { path: "src/new.ts", oldText: "", newText: "first\nsecond\n" },
      "Created src/new.ts",
      false,
      { ...RENDER_OPTS, verbose: true },
    );
    const text = collectText(node);

    expect(text).toContain("+first");
    expect(text).toContain("+second");
    expect(text).not.toContain("(new file)");
  });

  test("renderToolResult truncates edit diffs in non-verbose mode", () => {
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
      RENDER_OPTS,
    );
    const text = collectText(node);

    expect(text).toContain("~ src/file.ts");
    expect(text.at(-1)).toMatch(/^And \d+ lines more$/);
    expect(text).not.toContain("+new 11");
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
