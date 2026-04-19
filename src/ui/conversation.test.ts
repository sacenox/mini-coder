import { describe, expect, test } from "bun:test";
import type { Node, TextNode } from "@cel-tui/types";
import type { AssistantMessage, ToolResultMessage } from "@mariozechner/pi-ai";
import { DEFAULT_THEME } from "../theme.ts";
import {
  buildConversationLogNodes,
  renderAssistantMessage,
  renderToolResult,
} from "./conversation.ts";

function collectInlineText(node: Node): string {
  if (node.type === "text") {
    return node.content;
  }
  if (node.type === "textinput") {
    return "";
  }
  return node.children.map((child) => collectInlineText(child)).join("");
}

function collectRenderedLines(node: Node | null): string[] {
  if (!node) {
    return [];
  }
  if (node.type === "text") {
    return [node.content];
  }
  if (node.type === "textinput") {
    return [];
  }
  if (
    node.type === "hstack" &&
    node.children.length === 2 &&
    node.children[0]?.type === "text" &&
    node.children[1]?.type === "vstack"
  ) {
    const prefix = node.children[0].content;
    return collectRenderedLines(node.children[1]).map(
      (line) => `${prefix}${line}`,
    );
  }
  if (node.type === "hstack") {
    return [collectInlineText(node)];
  }
  return node.children.flatMap((child) => collectRenderedLines(child));
}

function collectTextNodes(node: Node | null): TextNode[] {
  if (!node || node.type === "textinput") {
    return [];
  }
  if (node.type === "text") {
    return [node];
  }
  return node.children.flatMap((child) => collectTextNodes(child));
}

function makeAssistantToolCallMessage(): AssistantMessage {
  return {
    role: "assistant",
    content: [
      {
        type: "toolCall",
        id: "call-read",
        name: "read",
        arguments: { path: "hint.txt", limit: 3 },
      },
    ],
    api: "anthropic-messages",
    provider: "anthropic",
    model: "claude-sonnet-4-20250514",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        total: 0,
      },
    },
    stopReason: "toolUse",
    timestamp: 1,
  };
}

function makeReadToolResultMessage(
  content: ToolResultMessage["content"],
): ToolResultMessage {
  return {
    role: "toolResult",
    toolCallId: "call-read",
    toolName: "read",
    content,
    isError: false,
    timestamp: 2,
  };
}

describe("ui/conversation", () => {
  test("read tool-call previews render structured arguments instead of raw JSON", () => {
    const node = renderAssistantMessage(
      {
        content: [
          {
            type: "toolCall",
            id: "call-read",
            name: "read",
            arguments: {
              path: "src/ui/conversation.ts",
              offset: 820,
              limit: 80,
            },
          },
        ],
      },
      {
        showReasoning: true,
        verbose: false,
        theme: DEFAULT_THEME,
        cwd: "/tmp/project",
        previewWidth: 80,
      },
    );

    const lines = collectRenderedLines(node);
    expect(lines).toContain("│ read ->");
    expect(lines).toContain("│ src/ui/conversation.ts");
    expect(lines).toContain("│ offset: 820");
    expect(lines).toContain("│ limit: 80");
    expect(lines.join("\n")).not.toContain('"path"');
  });

  test("shell tool-call previews render the command instead of raw JSON", () => {
    const node = renderAssistantMessage(
      {
        content: [
          {
            type: "toolCall",
            id: "call-shell",
            name: "shell",
            arguments: {
              command: 'if true; then echo "$HOME"; fi',
            },
          },
        ],
      },
      {
        showReasoning: true,
        verbose: true,
        theme: DEFAULT_THEME,
        cwd: "/tmp/project",
        previewWidth: 80,
      },
    );

    const lines = collectRenderedLines(node);
    expect(lines).toContain("│ shell ->");
    expect(lines.join("\n")).toContain('if true; then echo "$HOME"; fi');
    expect(lines.join("\n")).not.toContain('"command"');
  });

  test("shell tool results render structured stdout/stderr details and keep exit code visible in preview", () => {
    const stdout = Array.from(
      { length: 12 },
      (_, index) => `line ${index + 1}`,
    ).join("\n");
    const lines = collectRenderedLines(
      renderToolResult(
        "shell",
        { command: "run-tests" },
        "Exit code: 1\nlegacy text should be ignored when details exist",
        true,
        {
          showReasoning: true,
          verbose: false,
          theme: DEFAULT_THEME,
          cwd: "/tmp/project",
          previewWidth: 48,
        },
        {
          stdout,
          stderr: "boom",
          exitCode: 1,
        },
      ),
    );

    expect(lines).toContain("│ shell <-");
    expect(lines).toContain("│ stderr:");
    expect(lines).toContain("│ boom");
    expect(lines).toContain("│ exit 1");
    expect(lines).toContain("│ And 7 lines more");
    expect(lines.join("\n")).not.toContain("legacy text should be ignored");
  });

  test("shell tool results still render legacy flattened results from persisted history", () => {
    const lines = collectRenderedLines(
      renderToolResult(
        "shell",
        { command: "run-tests" },
        "Exit code: 1\nout\n\n[stderr]\nerr",
        true,
        {
          showReasoning: true,
          verbose: true,
          theme: DEFAULT_THEME,
          cwd: "/tmp/project",
          previewWidth: 80,
        },
      ),
    );

    expect(lines).toContain("│ out");
    expect(lines).toContain("│ stderr:");
    expect(lines).toContain("│ err");
    expect(lines).toContain("│ exit 1");
    expect(lines.join("\n")).not.toContain("[stderr]");
    expect(lines.join("\n")).not.toContain("Exit code:");
  });

  test("read tool results include the resolved path, hide model paging hints, and render fewer body lines when verbose is off", () => {
    const fileBody =
      Array.from({ length: 14 }, (_, index) => `line ${index + 1}`).join("\n") +
      "\n\n[use offset=14 limit=14 to continue]";

    const compactLines = collectRenderedLines(
      renderToolResult(
        "read",
        { path: "src/ui/conversation.ts" },
        fileBody,
        false,
        {
          showReasoning: true,
          verbose: false,
          theme: DEFAULT_THEME,
          cwd: "/tmp/project",
          previewWidth: 48,
        },
      ),
    );
    const verboseLines = collectRenderedLines(
      renderToolResult(
        "read",
        { path: "src/ui/conversation.ts" },
        fileBody,
        false,
        {
          showReasoning: true,
          verbose: true,
          theme: DEFAULT_THEME,
          cwd: "/tmp/project",
          previewWidth: 48,
        },
      ),
    );

    expect(compactLines[0]).toBe(
      "│ read <- /tmp/project/src/ui/conversation.ts",
    );
    expect(compactLines.join("\n")).not.toContain("Use offset=14 limit=14");
    expect(verboseLines.join("\n")).not.toContain("Use offset=14 limit=14");
    expect(verboseLines).toContain("│ line 14");
    expect(compactLines.length).toBeLessThan(verboseLines.length);
  });

  test("read tool results preserve literal continuation-looking lines from the file body without showing the model paging hint", () => {
    const nodes = buildConversationLogNodes(
      {
        messages: [
          makeAssistantToolCallMessage(),
          makeReadToolResultMessage([
            {
              type: "text",
              text: "alpha\n\n[use offset=99 limit=10 to continue]\n",
            },
            {
              type: "text",
              text: "[use offset=3 limit=3 to continue]",
            },
          ]),
        ],
        showReasoning: true,
        verbose: true,
        theme: DEFAULT_THEME,
        cwd: "/tmp/project",
        versionLabel: "test",
      },
      {
        isStreaming: false,
        content: [],
        pendingToolResults: [],
      },
      0,
      80,
    );

    const lines = nodes.flatMap((node) => collectRenderedLines(node));
    expect(lines).toContain("│ [use offset=99 limit=10 to continue]");
    expect(lines.join("\n")).not.toContain("Use offset=3 limit=3 to continue.");
  });

  test("read tool fallback rendering normalizes CRLF line endings", () => {
    const lines = collectRenderedLines(
      renderToolResult(
        "read",
        { path: "notes.txt" },
        "alpha\r\nbeta\r\n",
        false,
        {
          showReasoning: true,
          verbose: true,
          theme: DEFAULT_THEME,
          cwd: "/tmp/project",
          previewWidth: 80,
        },
      ),
    );

    expect(lines).toContain("│ alpha");
    expect(lines).toContain("│ beta");
    expect(lines.some((line) => line.includes("\r"))).toBe(false);
  });

  test("read tool results use direct syntax-highlight rendering without chunking long tokens", () => {
    const node = renderToolResult(
      "read",
      { path: "src/example.ts" },
      "const supercalifragilisticexpialidociousIdentifier = 42",
      false,
      {
        showReasoning: true,
        verbose: true,
        theme: DEFAULT_THEME,
        cwd: "/tmp/project",
        previewWidth: 20,
      },
    );

    expect(
      collectTextNodes(node).some(
        (textNode) =>
          textNode.content === "supercalifragilisticexpialidociousIdentifier",
      ),
    ).toBe(true);
  });

  test("grep tool results render grouped files and lines instead of raw JSON", () => {
    const resultText = JSON.stringify(
      {
        limit: 10,
        truncated: false,
        files: [
          {
            path: "src/ui/conversation.ts",
            lines: [
              {
                kind: "match",
                lineNumber: 857,
                text: "function renderToolBlock(\n",
              },
              {
                kind: "context",
                lineNumber: 858,
                text: "  spec: ToolBlockSpec,\n",
              },
            ],
          },
        ],
      },
      null,
      2,
    );

    const node = renderToolResult(
      "grep",
      { pattern: "renderToolBlock" },
      resultText,
      false,
      {
        showReasoning: true,
        verbose: true,
        theme: DEFAULT_THEME,
        cwd: "/tmp/project",
        previewWidth: 80,
      },
    );

    const lines = collectRenderedLines(node);
    expect(lines).toContain("│ grep <-");
    expect(lines).toContain("│ src/ui/conversation.ts");
    expect(lines).toContain("│   857: function renderToolBlock(");
    expect(lines).toContain("│   858:   spec: ToolBlockSpec,");
    expect(lines.join("\n")).not.toContain('"files"');
    expect(lines.join("\n")).not.toContain('"kind"');
  });
});
