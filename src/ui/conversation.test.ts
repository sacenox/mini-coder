import { afterEach, describe, expect, test } from "bun:test";
import type { Node } from "@cel-tui/types";
import {
  fauxAssistantMessage,
  fauxText,
  fauxThinking,
  fauxToolCall,
} from "@mariozechner/pi-ai";
import { DEFAULT_THEME } from "../theme.ts";
import {
  buildConversationLogNodes,
  type PendingToolResult,
  previewToolRenderLines,
  renderAssistantMessage,
  renderToolResult,
  resetConversationRenderCache,
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

afterEach(() => {
  resetConversationRenderCache();
});

describe("ui/conversation", () => {
  test("renderAssistantMessage preserves visible paragraph order in streamed markdown", () => {
    const message = fauxAssistantMessage("First paragraph\n\nSecond paragraph");

    const text = collectText(renderAssistantMessage(message, RENDER_OPTS));
    const firstParagraphIndex = text.indexOf("First paragraph");
    const secondParagraphIndex = text.indexOf("Second paragraph");

    expect(firstParagraphIndex).toBeGreaterThanOrEqual(0);
    expect(secondParagraphIndex).toBeGreaterThan(firstParagraphIndex);
  });

  test("renderAssistantMessage shows thinking blocks when reasoning is enabled", () => {
    const message = fauxAssistantMessage([
      fauxThinking("I should inspect the tests first."),
      fauxText("Done."),
    ]);

    const text = collectText(
      renderAssistantMessage(message, {
        ...RENDER_OPTS,
        showReasoning: true,
      }),
    );

    expect(text).toContain("I should inspect the tests first.");
    expect(text).toContain("Done.");
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

  test("buildConversationLogNodes keeps tool call args and streamed shell output append-only", () => {
    const pendingToolResults: PendingToolResult[] = [
      {
        toolCallId: "tool-1",
        toolName: "shell",
        content: [{ type: "text", text: "Exit code: 0\npartial output" }],
        isError: false,
      },
    ];

    const nodes = buildConversationLogNodes(
      {
        messages: [
          fauxAssistantMessage([
            fauxText("Working..."),
            fauxToolCall("shell", { command: "echo hi" }, { id: "tool-1" }),
          ]),
        ],
        showReasoning: false,
        verbose: false,
        theme: DEFAULT_THEME,
      },
      {
        isStreaming: true,
        content: [],
        pendingToolResults,
      },
    );
    const text = collectText({
      type: "vstack",
      props: {},
      children: nodes,
    });

    expect(text).toContain("Working...");
    expect(text.filter((line) => line === "$ echo hi")).toHaveLength(1);
    expect(text).toContain("partial output");
    expect(text).not.toContain("Exit code: 0");
  });

  test("buildConversationLogNodes keeps hidden tool call args available when rendering a sliced window", () => {
    const nodes = buildConversationLogNodes(
      {
        messages: [
          fauxAssistantMessage([
            fauxToolCall(
              "edit",
              {
                path: "src/app.ts",
                oldText: "before",
                newText: "after",
              },
              { id: "tool-1" },
            ),
          ]),
          {
            role: "toolResult" as const,
            toolCallId: "tool-1",
            toolName: "edit",
            content: [{ type: "text" as const, text: "Updated src/app.ts" }],
            isError: false,
            timestamp: Date.now(),
          },
        ],
        showReasoning: false,
        verbose: false,
        theme: DEFAULT_THEME,
      },
      {
        isStreaming: false,
        content: [],
        pendingToolResults: [],
      },
      1,
    );
    const text = collectText({
      type: "vstack",
      props: {},
      children: nodes,
    });

    expect(text).toContain("@@ -1,1 +1,1 @@");
    expect(text).toContain("-before");
    expect(text).toContain("+after");
  });

  test("buildConversationLogNodes reuses cached committed nodes when the log is unchanged", () => {
    const state = {
      messages: [fauxAssistantMessage("Committed response")],
      showReasoning: false,
      verbose: false,
      theme: DEFAULT_THEME,
    };
    const streaming = {
      isStreaming: false,
      content: [],
      pendingToolResults: [],
    };

    const first = buildConversationLogNodes(state, streaming);
    const second = buildConversationLogNodes(state, streaming);

    expect(second).toBe(first);
  });

  test("buildConversationLogNodes reuses the committed prefix when only the streaming tail changes", () => {
    const state = {
      messages: [fauxAssistantMessage("Committed response")],
      showReasoning: false,
      verbose: false,
      theme: DEFAULT_THEME,
    };

    const committed = buildConversationLogNodes(state, {
      isStreaming: false,
      content: [],
      pendingToolResults: [],
    });
    const withStreamingTail = buildConversationLogNodes(state, {
      isStreaming: true,
      content: [fauxText("Streaming tail")],
      pendingToolResults: [],
    });
    const text = collectText({
      type: "vstack",
      props: {},
      children: withStreamingTail,
    });

    expect(withStreamingTail[0]).toBe(committed[0]);
    expect(text).toContain("Committed response");
    expect(text).toContain("Streaming tail");
  });

  test("buildConversationLogNodes rebuilds cached tool nodes when verbose mode changes", () => {
    const output = Array.from({ length: 25 }, (_, i) => `line ${i + 1}`).join(
      "\n",
    );
    const state = {
      messages: [
        fauxAssistantMessage([
          fauxToolCall("shell", { command: "seq 1 25" }, { id: "tool-1" }),
        ]),
        {
          role: "toolResult" as const,
          toolCallId: "tool-1",
          toolName: "shell",
          content: [{ type: "text" as const, text: output }],
          isError: false,
          timestamp: Date.now(),
        },
      ],
      showReasoning: false,
      verbose: false,
      theme: DEFAULT_THEME,
    };

    const previewNodes = buildConversationLogNodes(state, {
      isStreaming: false,
      content: [],
      pendingToolResults: [],
    });
    const previewText = collectText({
      type: "vstack",
      props: {},
      children: previewNodes,
    });

    const verboseNodes = buildConversationLogNodes(
      { ...state, verbose: true },
      {
        isStreaming: false,
        content: [],
        pendingToolResults: [],
      },
    );
    const verboseText = collectText({
      type: "vstack",
      props: {},
      children: verboseNodes,
    });

    expect(previewNodes).not.toBe(verboseNodes);
    expect(previewText).toContain("And 5 lines more");
    expect(verboseText).toContain("line 25");
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

  test("renderAssistantMessage shows streamed shell arguments semantically", () => {
    const node = renderAssistantMessage(
      {
        content: [
          fauxToolCall("shell", { command: "echo hi" }, { id: "tool-1" }),
        ],
      },
      RENDER_OPTS,
    );
    const text = collectText(node);

    expect(text).toContain("$ echo hi");
    expect(text).not.toContain('"command": "echo hi"');
    expect(text).not.toContain("Preparing...");
  });

  test("renderAssistantMessage shows streamed readImage arguments semantically", () => {
    const node = renderAssistantMessage(
      {
        content: [
          fauxToolCall(
            "readImage",
            { path: "assets/preview.png" },
            { id: "tool-1" },
          ),
        ],
      },
      RENDER_OPTS,
    );
    const text = collectText(node);

    expect(text).toContain("~ assets/preview.png");
    expect(text).not.toContain("{");
  });

  test("renderAssistantMessage shows streamed edit arguments semantically", () => {
    const node = renderAssistantMessage(
      {
        content: [
          fauxToolCall(
            "edit",
            {
              path: "src/file.ts",
              oldText: "old line",
              newText: "new line",
            },
            { id: "tool-1" },
          ),
        ],
      },
      RENDER_OPTS,
    );
    const text = collectText(node);

    expect(text).toContain("~ src/file.ts");
    expect(text).toContain("-old line");
    expect(text).toContain("+new line");
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

    expect(text).toContain("line 1");
    expect(text).toContain("line 20");
    expect(text).toContain("And 5 lines more");
    expect(text).not.toContain("line 21");
    expect(text).not.toContain("$ seq 1 25");
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

  test("renderToolResult strips shell exit-code and stderr labels in the UI", () => {
    const node = renderToolResult(
      "shell",
      { command: "exit 42" },
      "Exit code: 42\n[stderr]\nboom",
      true,
      RENDER_OPTS,
    );
    const text = collectText(node);

    expect(text).toContain("boom");
    expect(text).not.toContain("$ exit 42");
    expect(text).not.toContain("Exit code: 42");
    expect(text).not.toContain("[stderr]");
  });

  test("renderToolResult shows a readImage success message", () => {
    const node = renderToolResult(
      "readImage",
      { path: "diagram.png" },
      "",
      false,
      RENDER_OPTS,
    );
    const text = collectText(node);

    expect(text).toContain("Read image.");
    expect(text).not.toContain("~ diagram.png");
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

    expect(text).not.toContain("~ src/file.ts");
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
