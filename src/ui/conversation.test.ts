import { afterEach, describe, expect, test } from "bun:test";
import {
  cel,
  MockTerminal,
  measureContentHeight,
  Text,
  VStack,
} from "@cel-tui/core";
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
  renderAssistantMessage,
  renderToolResult,
  resetConversationRenderCache,
} from "./conversation.ts";

const PREVIEW_WIDTH = 32;
const RENDER_OPTS = {
  showReasoning: false,
  verbose: false,
  theme: DEFAULT_THEME,
  previewWidth: PREVIEW_WIDTH,
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
  if (
    node.type === "hstack" &&
    node.children.every((child) => child.type === "text")
  ) {
    return [node.children.map((child) => child.content).join("")];
  }
  return node.children.flatMap((child) => collectText(child));
}

function measureRenderedHeight(node: Node | null, width: number): number {
  if (!node) {
    return 0;
  }
  return measureContentHeight(VStack({}, [node]), { width });
}

async function waitForCelRender(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 10));
}

async function renderBufferRows(
  node: Node | null,
  cols = PREVIEW_WIDTH,
  rows = 24,
): Promise<
  Array<{
    text: string;
    fgColors: Array<string | null>;
    bold: boolean[];
    italic: boolean[];
    underline: boolean[];
  }>
> {
  if (!node) {
    return [];
  }

  const terminal = new MockTerminal(cols, rows);
  cel.init(terminal);
  cel.viewport(() => VStack({ width: cols, height: rows }, [node]));
  await waitForCelRender();

  const buffer = cel._getBuffer();
  if (!buffer) {
    throw new Error("Expected cel-tui to produce a render buffer");
  }

  const snapshot: Array<{
    text: string;
    fgColors: Array<string | null>;
    bold: boolean[];
    italic: boolean[];
    underline: boolean[];
  }> = [];
  for (let y = 0; y < rows; y++) {
    let text = "";
    const fgColors: Array<string | null> = [];
    const bold: boolean[] = [];
    const italic: boolean[] = [];
    const underline: boolean[] = [];
    for (let x = 0; x < cols; x++) {
      const cell = buffer.get(x, y);
      text += cell.char;
      fgColors.push(cell.fgColor);
      bold.push(cell.bold);
      italic.push(cell.italic);
      underline.push(cell.underline);
    }
    snapshot.push({ text, fgColors, bold, italic, underline });
  }

  cel.stop();
  return snapshot;
}

async function renderVisibleText(
  node: Node | null,
  cols = PREVIEW_WIDTH,
  rows = 24,
): Promise<string[]> {
  const snapshot = await renderBufferRows(node, cols, rows);
  const lines: string[] = [];

  for (const row of snapshot) {
    const normalized = row.text.trim().replace(/^│\s*/, "");
    if (normalized !== "") {
      lines.push(normalized);
    }
  }

  return lines;
}

afterEach(() => {
  resetConversationRenderCache();
  cel.stop();
});

describe("ui/conversation", () => {
  test("renderAssistantMessage keeps raw markdown markers visible in assistant text", () => {
    // Arrange
    const message = fauxAssistantMessage(
      "# Heading\n\nUse **bold** and `code`.\n- item",
    );

    // Act
    const text = collectText(renderAssistantMessage(message, RENDER_OPTS));

    // Assert
    expect(text).toContain("# Heading");
    expect(text).toContain("Use **bold** and `code`.");
    expect(text).toContain("- item");
    expect(text).not.toContain("Use bold and code.");
  });

  test("renderAssistantMessage with reasoning enabled shows thinking blocks", () => {
    // Arrange
    const message = fauxAssistantMessage([
      fauxThinking("I should inspect the tests first."),
      fauxText("Done."),
    ]);

    // Act
    const text = collectText(
      renderAssistantMessage(message, {
        ...RENDER_OPTS,
        showReasoning: true,
      }),
    );

    // Assert
    expect(text).toContain("I should inspect the tests first.");
    expect(text).toContain("Done.");
  });

  test("renderAssistantMessage with reasoning hidden shows a thinking line-count placeholder", () => {
    // Arrange
    const message = fauxAssistantMessage([
      fauxThinking("line one\nline two\nline three"),
      fauxText("Done."),
    ]);

    // Act
    const text = collectText(
      renderAssistantMessage(message, {
        ...RENDER_OPTS,
        showReasoning: false,
      }),
    );

    // Assert
    expect(text).toContain("Thinking... 3 lines.");
    expect(text).toContain("Done.");
    expect(text).not.toContain("line one");
    expect(text).not.toContain("line two");
  });

  test("renderAssistantMessage with mixed top-level blocks keeps a single blank line between sections", () => {
    // Arrange
    const message = fauxAssistantMessage([
      fauxThinking("Plan first."),
      fauxText("Done."),
      fauxToolCall("shell", { command: "echo hi" }, { id: "tool-1" }),
    ]);

    // Act
    const height = measureRenderedHeight(
      renderAssistantMessage(message, {
        ...RENDER_OPTS,
        showReasoning: true,
      }),
      PREVIEW_WIDTH,
    );

    // Assert
    expect(height).toBe(6);
  });

  test("renderAssistantMessage syntax-highlights markdown tokens with theme-derived colors", async () => {
    // Arrange
    const theme = {
      ...DEFAULT_THEME,
      accentText: "color14",
      secondaryAccentText: "color09",
      diffAdded: "color10",
      mutedText: "color13",
    } satisfies typeof DEFAULT_THEME;
    const message = fauxAssistantMessage("# Heading\n- item\n> quote\n`code`");

    // Act
    const rows = await renderBufferRows(
      renderAssistantMessage(message, {
        ...RENDER_OPTS,
        theme,
      }),
      32,
      12,
    );
    const headingRow = rows.find((row) => row.text.includes("# Heading"));
    const bulletRow = rows.find((row) => row.text.includes("- item"));
    const quoteRow = rows.find((row) => row.text.includes("> quote"));
    const codeRow = rows.find((row) => row.text.includes("`code`"));

    // Assert
    expect(headingRow).toBeDefined();
    expect(bulletRow).toBeDefined();
    expect(quoteRow).toBeDefined();
    expect(codeRow).toBeDefined();
    expect(headingRow?.fgColors[headingRow.text.indexOf("#")]).toBe(
      theme.accentText ?? null,
    );
    expect(bulletRow?.fgColors[bulletRow.text.indexOf("-")]).toBe(
      theme.secondaryAccentText ?? null,
    );
    expect(quoteRow?.fgColors[quoteRow.text.indexOf(">")]).toBe(
      theme.mutedText ?? null,
    );
    expect(quoteRow?.italic[quoteRow.text.indexOf(">")]).toBe(true);
    expect(codeRow?.fgColors[codeRow.text.indexOf("`")]).toBe(
      theme.diffAdded ?? null,
    );
  });

  test("renderAssistantMessage syntax-highlights markdown emphasis and links with style cues", async () => {
    // Arrange
    const theme = {
      ...DEFAULT_THEME,
      accentText: "color14",
      diffAdded: "color10",
    } satisfies typeof DEFAULT_THEME;
    const message = fauxAssistantMessage(
      "*italic* **bold** [label](https://example.com)",
    );

    // Act
    const rows = await renderBufferRows(
      renderAssistantMessage(message, {
        ...RENDER_OPTS,
        theme,
      }),
      64,
      12,
    );
    const contentRow = rows.find((row) =>
      row.text.includes("*italic* **bold** [label](https://example.com)"),
    );

    // Assert
    expect(contentRow).toBeDefined();
    expect(contentRow?.italic[contentRow.text.indexOf("*italic*")]).toBe(true);
    expect(contentRow?.bold[contentRow.text.indexOf("**bold**")]).toBe(true);
    expect(contentRow?.fgColors[contentRow.text.indexOf("label")]).toBe(
      theme.diffAdded ?? null,
    );
    expect(
      contentRow?.fgColors[contentRow.text.indexOf("https://example.com")],
    ).toBe(theme.accentText ?? null);
    expect(
      contentRow?.underline[contentRow.text.indexOf("https://example.com")],
    ).toBe(true);
  });

  test("buildConversationLogNodes with a pending shell result keeps the streamed call and result append-only", () => {
    // Arrange
    const pendingToolResults: PendingToolResult[] = [
      {
        toolCallId: "tool-1",
        toolName: "shell",
        content: [{ type: "text", text: "Exit code: 0\npartial output" }],
        isError: false,
      },
    ];

    // Act
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
      0,
      PREVIEW_WIDTH,
    );
    const text = collectText({
      type: "vstack",
      props: {},
      children: nodes,
    });

    // Assert
    expect(text).toContain("Working...");
    expect(text.filter((line) => line === "shell ->")).toHaveLength(1);
    expect(text).toContain("echo hi");
    expect(text).toContain("shell <-");
    expect(text).toContain("partial output");
    expect(text).not.toContain("Exit code: 0");
  });

  test("buildConversationLogNodes with a sliced window keeps hidden tool-call args available for compact edit results", () => {
    // Arrange
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
            content: [{ type: "text" as const, text: "Edited src/app.ts" }],
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
      PREVIEW_WIDTH,
    );
    const text = collectText({
      type: "vstack",
      props: {},
      children: nodes,
    });

    // Assert
    expect(text).toContain("edit <-");
    expect(text).toContain("~ src/app.ts");
    expect(text).not.toContain("before");
    expect(text).not.toContain("after");
  });

  test("buildConversationLogNodes with unchanged state reuses cached committed nodes", () => {
    // Arrange
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

    // Act
    const first = buildConversationLogNodes(state, streaming, 0, PREVIEW_WIDTH);
    const second = buildConversationLogNodes(
      state,
      streaming,
      0,
      PREVIEW_WIDTH,
    );

    // Assert
    expect(second).toBe(first);
  });

  test("buildConversationLogNodes with only a new streaming tail reuses the committed prefix", () => {
    // Arrange
    const state = {
      messages: [fauxAssistantMessage("Committed response")],
      showReasoning: false,
      verbose: false,
      theme: DEFAULT_THEME,
    };

    // Act
    const committed = buildConversationLogNodes(
      state,
      {
        isStreaming: false,
        content: [],
        pendingToolResults: [],
      },
      0,
      PREVIEW_WIDTH,
    );
    const withStreamingTail = buildConversationLogNodes(
      state,
      {
        isStreaming: true,
        content: [fauxText("Streaming tail")],
        pendingToolResults: [],
      },
      0,
      PREVIEW_WIDTH,
    );
    const text = collectText({
      type: "vstack",
      props: {},
      children: withStreamingTail,
    });

    // Assert
    expect(withStreamingTail[0]).toBe(committed[0]);
    expect(text).toContain("Committed response");
    expect(text).toContain("Streaming tail");
  });

  test("buildConversationLogNodes when verbose mode changes rebuilds cached tool nodes", async () => {
    // Arrange
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

    // Act
    const previewNodes = buildConversationLogNodes(
      state,
      {
        isStreaming: false,
        content: [],
        pendingToolResults: [],
      },
      0,
      PREVIEW_WIDTH,
    );
    const previewText = await renderVisibleText(
      VStack({}, previewNodes),
      PREVIEW_WIDTH,
      24,
    );

    const verboseNodes = buildConversationLogNodes(
      { ...state, verbose: true },
      {
        isStreaming: false,
        content: [],
        pendingToolResults: [],
      },
      0,
      PREVIEW_WIDTH,
    );
    const verboseText = await renderVisibleText(
      VStack({}, verboseNodes),
      PREVIEW_WIDTH,
      40,
    );

    // Assert
    expect(previewNodes).not.toBe(verboseNodes);
    expect(previewText).toContain("line 18");
    expect(previewText).toContain("line 25");
    expect(previewText).toContain("And 17 lines more");
    expect(previewText).not.toContain("line 17");
    expect(verboseText).toContain("line 17");
    expect(verboseText).toContain("line 25");
    expect(verboseText).not.toContain("And 17 lines more");
  });

  test("buildConversationLogNodes when preview width changes rebuilds cached tool nodes", () => {
    // Arrange
    const state = {
      messages: [
        fauxAssistantMessage([
          fauxToolCall(
            "shell",
            {
              command:
                "printf 'this is a very long wrapped line that depends on width'",
            },
            { id: "tool-1" },
          ),
        ]),
      ],
      showReasoning: false,
      verbose: false,
      theme: DEFAULT_THEME,
    };
    const streaming = {
      isStreaming: false,
      content: [],
      pendingToolResults: [],
    };

    // Act
    const wide = buildConversationLogNodes(state, streaming, 0, 40);
    const narrow = buildConversationLogNodes(state, streaming, 0, 20);

    // Assert
    expect(narrow).not.toBe(wide);
  });

  test("renderAssistantMessage with in-progress reasoning visible shows thinking text", () => {
    // Arrange
    const assistant = {
      content: [fauxThinking("Reasoning in progress")],
    };

    // Act
    const text = collectText(
      renderAssistantMessage(assistant, {
        ...RENDER_OPTS,
        showReasoning: true,
      }),
    );

    // Assert
    expect(text).toContain("Reasoning in progress");
  });

  test("renderAssistantMessage with in-progress reasoning hidden shows a one-line placeholder", () => {
    // Arrange
    const assistant = {
      content: [fauxThinking("some thinking")],
    };

    // Act
    const text = collectText(
      renderAssistantMessage(assistant, {
        ...RENDER_OPTS,
        showReasoning: false,
      }),
    );

    // Assert
    expect(text).toContain("Thinking... 1 line.");
  });

  test("renderAssistantMessage for a shell tool call renders an unbracketed header inside the pill", () => {
    // Arrange
    const assistant = {
      content: [
        fauxToolCall("shell", { command: "echo hi" }, { id: "tool-1" }),
      ],
    };

    // Act
    const node = renderAssistantMessage(assistant, RENDER_OPTS);
    const text = collectText(node);

    // Assert
    expect(text).toContain("shell ->");
    expect(text).not.toContain("[shell ->]");
    expect(text).toContain("echo hi");
    expect(text).not.toContain('"command": "echo hi"');

    expect(node?.type).toBe("vstack");
    if (!node || node.type !== "vstack") {
      throw new Error("Expected the assistant node to be a vstack");
    }

    const toolBlock = node.children[0];
    expect(toolBlock?.type).toBe("hstack");
    if (!toolBlock || toolBlock.type !== "hstack") {
      throw new Error("Expected the tool block to be an hstack");
    }

    const contentColumn = toolBlock.children[1];
    expect(contentColumn?.type).toBe("vstack");
    if (!contentColumn || contentColumn.type !== "vstack") {
      throw new Error("Expected the tool content column to be a vstack");
    }

    const headerRow = contentColumn.children[0];
    expect(headerRow?.type).toBe("hstack");
    if (!headerRow || headerRow.type !== "hstack") {
      throw new Error("Expected the tool header row to be an hstack");
    }

    const headerPill = headerRow.children[0];
    expect(headerPill?.type).toBe("hstack");
    if (!headerPill || headerPill.type !== "hstack") {
      throw new Error("Expected the tool header pill to be an hstack");
    }

    expect(headerPill.props.bgColor).toBe(DEFAULT_THEME.toolBorder);
    expect(headerPill.props.padding).toEqual({ x: 1 });
    expect(collectText(headerPill)).toEqual(["shell ->"]);
  });

  test("renderAssistantMessage for a shell tool call syntax-highlights bash tokens", async () => {
    // Arrange
    const assistant = {
      content: [
        fauxToolCall(
          "shell",
          { command: 'if true; then echo "$HOME"; fi' },
          { id: "tool-1" },
        ),
      ],
    };

    // Act
    const rows = await renderBufferRows(
      renderAssistantMessage(assistant, RENDER_OPTS),
      48,
      12,
    );
    const commandRow = rows.find((row) =>
      row.text.includes('if true; then echo "$HOME"; fi'),
    );

    // Assert
    expect(commandRow).toBeDefined();
    expect(commandRow?.fgColors[commandRow.text.indexOf("if")]).toBe(
      DEFAULT_THEME.secondaryAccentText ?? null,
    );
    expect(commandRow?.fgColors[commandRow.text.indexOf("echo")]).toBe(
      DEFAULT_THEME.accentText ?? null,
    );
    expect(commandRow?.fgColors[commandRow.text.indexOf('"$HOME"')]).toBe(
      DEFAULT_THEME.diffAdded ?? null,
    );
  });

  test("renderAssistantMessage for a multiline shell tool call preserves syntax state across lines", async () => {
    // Arrange
    const assistant = {
      content: [
        fauxToolCall(
          "shell",
          { command: "printf 'foo\nbar'" },
          { id: "tool-1" },
        ),
      ],
    };

    // Act
    const rows = await renderBufferRows(
      renderAssistantMessage(assistant, {
        ...RENDER_OPTS,
        verbose: true,
      }),
      32,
      12,
    );
    const firstRow = rows.find((row) => row.text.includes("printf 'foo"));
    const secondRow = rows.find((row) => row.text.includes("bar'"));

    // Assert
    expect(firstRow).toBeDefined();
    expect(secondRow).toBeDefined();
    expect(firstRow?.fgColors[firstRow.text.indexOf("foo")]).toBe(
      DEFAULT_THEME.diffAdded ?? null,
    );
    expect(secondRow?.fgColors[secondRow.text.indexOf("bar")]).toBe(
      DEFAULT_THEME.diffAdded ?? null,
    );
  });

  test("renderAssistantMessage for a shell tool call uses theme-derived syntax colors", async () => {
    // Arrange
    const theme = {
      ...DEFAULT_THEME,
      accentText: "color14",
      secondaryAccentText: "color09",
      diffAdded: "color10",
      mutedText: "color13",
      toolText: "color15",
    } satisfies typeof DEFAULT_THEME;
    const assistant = {
      content: [
        fauxToolCall(
          "shell",
          { command: 'if true; then echo "$HOME"; fi' },
          { id: "tool-1" },
        ),
      ],
    };

    // Act
    const rows = await renderBufferRows(
      renderAssistantMessage(assistant, {
        ...RENDER_OPTS,
        theme,
      }),
      48,
      12,
    );
    const commandRow = rows.find((row) =>
      row.text.includes('if true; then echo "$HOME"; fi'),
    );

    // Assert
    expect(commandRow).toBeDefined();
    expect(commandRow?.fgColors[commandRow.text.indexOf("if")]).toBe(
      theme.secondaryAccentText ?? null,
    );
    expect(commandRow?.fgColors[commandRow.text.indexOf("echo")]).toBe(
      theme.accentText ?? null,
    );
    expect(commandRow?.fgColors[commandRow.text.indexOf('"$HOME"')]).toBe(
      theme.diffAdded ?? null,
    );
  });

  test("renderAssistantMessage for a long single-token shell argument wraps through the tail in verbose mode", async () => {
    // Arrange
    const command = `printf ${"x".repeat(60)}TAIL`;
    const assistant = {
      content: [fauxToolCall("shell", { command }, { id: "tool-1" })],
    };

    // Act
    const text = await renderVisibleText(
      renderAssistantMessage(assistant, {
        ...RENDER_OPTS,
        verbose: true,
        previewWidth: 24,
      }),
      24,
      20,
    );

    // Assert
    expect(text.some((line) => line.includes("TAIL"))).toBe(true);
  });

  test("renderAssistantMessage for a long single-token shell command uses wrapped preview height when verbose is off", () => {
    // Arrange
    const command = `printf ${"x".repeat(220)}TAIL`;
    const assistant = {
      content: [fauxToolCall("shell", { command }, { id: "tool-1" })],
    };

    // Act
    const height = measureRenderedHeight(
      renderAssistantMessage(assistant, {
        ...RENDER_OPTS,
        previewWidth: 24,
      }),
      24,
    );

    // Assert
    expect(height).toBe(9);
  });

  test("renderAssistantMessage for a wrapped shell command keeps a fixed preview height when verbose is off", () => {
    // Arrange
    const command = Array.from(
      { length: 4 },
      () =>
        "printf 'this wrapped command line is intentionally long for the preview'",
    ).join("\n");
    const assistant = {
      content: [fauxToolCall("shell", { command }, { id: "tool-1" })],
    };

    // Act
    const node = renderAssistantMessage(assistant, {
      ...RENDER_OPTS,
      previewWidth: 24,
    });
    const height = measureRenderedHeight(node, 24);

    // Assert
    expect(height).toBe(10);
  });

  test("renderAssistantMessage for a long single-line shell command keeps the command start visible in non-verbose mode", async () => {
    // Arrange
    const command = `IMPORTANT_PREFIX ${"x".repeat(400)}`;
    const assistant = {
      content: [fauxToolCall("shell", { command }, { id: "tool-1" })],
    };

    // Act
    const text = await renderVisibleText(
      renderAssistantMessage(assistant, {
        ...RENDER_OPTS,
        previewWidth: 24,
      }),
      24,
      20,
    );

    // Assert
    expect(text.some((line) => line.includes("IMPORTANT_PREFIX"))).toBe(true);
  });

  test("renderToolResult for a shell preview allows the outer conversation scroll to handle mouse wheel events", async () => {
    // Arrange
    const terminal = new MockTerminal(24, 10);
    let outerScrollOffset = 0;
    const toolNode = renderToolResult(
      "shell",
      { command: "seq 1 25" },
      Array.from({ length: 25 }, (_, i) => `line ${i + 1}`).join("\n"),
      false,
      {
        ...RENDER_OPTS,
        previewWidth: 24,
      },
    );

    cel.init(terminal);
    cel.viewport(() =>
      VStack(
        {
          width: 24,
          height: 10,
          overflow: "scroll",
          scrollOffset: outerScrollOffset,
          onScroll: (offset) => {
            outerScrollOffset = offset;
          },
        },
        [
          Text("before 1"),
          toolNode,
          Text("after 1"),
          Text("after 2"),
          Text("after 3"),
          Text("after 4"),
          Text("after 5"),
        ],
      ),
    );
    await waitForCelRender();

    // Act
    terminal.sendInput("\x1b[<65;4;3M");
    await waitForCelRender();

    // Assert
    expect(outerScrollOffset).toBeGreaterThan(0);
  });

  test("renderAssistantMessage for a readImage tool call shows the path rather than JSON", () => {
    // Arrange
    const assistant = {
      content: [
        fauxToolCall(
          "readImage",
          { path: "assets/preview.png" },
          { id: "tool-1" },
        ),
      ],
    };

    // Act
    const text = collectText(renderAssistantMessage(assistant, RENDER_OPTS));

    // Assert
    expect(text).toContain("read image ->");
    expect(text).toContain("assets/preview.png");
    expect(text).not.toContain("{");
  });

  test("renderAssistantMessage for an edit tool call shows both old and new content without diff prefixes", () => {
    // Arrange
    const assistant = {
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
    };

    // Act
    const text = collectText(renderAssistantMessage(assistant, RENDER_OPTS));

    // Assert
    expect(text).toContain("edit ->");
    expect(text).toContain("src/file.ts");
    expect(text).toContain("old line");
    expect(text).toContain("new line");
    expect(text).not.toContain("+new line");
    expect(text).not.toContain("-old line");
  });

  test("renderAssistantMessage for an edit tool call colors old text red and new text green", async () => {
    // Arrange
    const assistant = {
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
    };

    // Act
    const rows = await renderBufferRows(
      renderAssistantMessage(assistant, RENDER_OPTS),
      PREVIEW_WIDTH,
      12,
    );
    const oldRow = rows.find((row) => row.text.includes("old line"));
    const newRow = rows.find((row) => row.text.includes("new line"));

    // Assert
    expect(oldRow).toBeDefined();
    expect(newRow).toBeDefined();

    const oldColor = oldRow?.fgColors[oldRow.text.indexOf("o")];
    const newColor = newRow?.fgColors[newRow.text.indexOf("n")];
    expect(oldColor).toBe(DEFAULT_THEME.diffRemoved ?? null);
    expect(newColor).toBe(DEFAULT_THEME.diffAdded ?? null);
  });

  test("renderToolResult for shell output in non-verbose mode shows the visible tail under a result header", async () => {
    // Arrange
    const output = Array.from({ length: 25 }, (_, i) => `line ${i + 1}`).join(
      "\n",
    );

    // Act
    const text = await renderVisibleText(
      renderToolResult(
        "shell",
        { command: "seq 1 25" },
        output,
        false,
        RENDER_OPTS,
      ),
      PREVIEW_WIDTH,
      24,
    );

    // Assert
    expect(text).toContain("shell <-");
    expect(text).toContain("line 18");
    expect(text).toContain("line 25");
    expect(text).toContain("And 17 lines more");
    expect(text).not.toContain("line 17");
    expect(text).not.toContain("seq 1 25");
  });

  test("renderToolResult for shell output in verbose mode shows the full stored output", () => {
    // Arrange
    const output = Array.from({ length: 25 }, (_, i) => `line ${i + 1}`).join(
      "\n",
    );

    // Act
    const text = collectText(
      renderToolResult("shell", { command: "seq 1 25" }, output, false, {
        ...RENDER_OPTS,
        verbose: true,
      }),
    );

    // Assert
    expect(text).toContain("line 17");
    expect(text).toContain("line 25");
    expect(text).not.toContain("And 17 lines more");
  });

  test("renderToolResult for shell errors normalizes exit-code and stderr labels", () => {
    // Arrange
    const resultText = "Exit code: 42\n[stderr]\nboom";

    // Act
    const text = collectText(
      renderToolResult(
        "shell",
        { command: "exit 42" },
        resultText,
        true,
        RENDER_OPTS,
      ),
    );

    // Assert
    expect(text).toContain("shell <-");
    expect(text).toContain("exit 42");
    expect(text).toContain("boom");
    expect(text).not.toContain("Exit code: 42");
    expect(text).not.toContain("[stderr]");
  });

  test("renderToolResult for a readImage success shows a compact path result", () => {
    // Arrange
    const args = { path: "diagram.png" };

    // Act
    const text = collectText(
      renderToolResult("readImage", args, "", false, RENDER_OPTS),
    );

    // Assert
    expect(text).toContain("read image <-");
    expect(text).toContain("diagram.png");
    expect(text).not.toContain("Read image.");
  });

  test("renderToolResult for a readImage error shows the full error even when verbose is off", () => {
    // Arrange
    const errorText = Array.from(
      { length: 25 },
      (_, i) => `error ${i + 1}`,
    ).join("\n");

    // Act
    const text = collectText(
      renderToolResult(
        "readImage",
        { path: "diagram.png" },
        errorText,
        true,
        RENDER_OPTS,
      ),
    );

    // Assert
    expect(text).toContain("error 1");
    expect(text).toContain("error 25");
    expect(text.some((line) => /^And \d+ lines more$/.test(line))).toBe(false);
  });

  test("renderToolResult for a successful edit stays compact regardless of verbose mode", () => {
    // Arrange
    const args = {
      path: "src/file.ts",
      oldText: "before",
      newText: "after",
    };

    // Act
    const previewText = collectText(
      renderToolResult("edit", args, "Edited src/file.ts", false, RENDER_OPTS),
    );
    const verboseText = collectText(
      renderToolResult("edit", args, "Edited src/file.ts", false, {
        ...RENDER_OPTS,
        verbose: true,
      }),
    );

    // Assert
    expect(previewText).toContain("edit <-");
    expect(previewText).toContain("~ src/file.ts");
    expect(previewText).not.toContain("before");
    expect(previewText).not.toContain("after");
    expect(previewText).not.toContain("And 1 lines more");
    expect(verboseText).toEqual(previewText);
  });

  test("renderToolResult for an edit error uses the preview policy in non-verbose mode", async () => {
    // Arrange
    const errorText = Array.from(
      { length: 25 },
      (_, i) => `error ${i + 1}`,
    ).join("\n");

    // Act
    const text = await renderVisibleText(
      renderToolResult(
        "edit",
        {
          path: "src/file.ts",
          oldText: "before",
          newText: "after",
        },
        errorText,
        true,
        RENDER_OPTS,
      ),
      PREVIEW_WIDTH,
      24,
    );

    // Assert
    expect(text).toContain("edit <-");
    expect(text).toContain("error 18");
    expect(text).toContain("error 25");
    expect(text).toContain("And 17 lines more");
    expect(text).not.toContain("error 17");
  });

  test("renderToolResult for a generic plugin tool uses the shared result header", () => {
    // Arrange
    const args = { query: "session persistence sqlite turn numbering" };

    // Act
    const text = collectText(
      renderToolResult(
        "mcp/search",
        args,
        "session persistence sqlite turn numbering",
        false,
        RENDER_OPTS,
      ),
    );

    // Assert
    expect(text).toContain("mcp/search <-");
    expect(text).toContain("session persistence sqlite turn numbering");
    expect(text).not.toContain('"query"');
  });
});
