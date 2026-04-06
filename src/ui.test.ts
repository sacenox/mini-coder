import { describe, expect, test } from "bun:test";
import type { Node } from "@cel-tui/types";
import {
  fauxAssistantMessage,
  fauxText,
  fauxThinking,
  registerFauxProvider,
} from "@mariozechner/pi-ai";
import {
  type AppState,
  DEFAULT_SHOW_REASONING,
  DEFAULT_VERBOSE,
} from "./index.ts";
import { createSession, loadMessages, openDatabase } from "./session.ts";
import { DEFAULT_THEME, type Theme } from "./theme.ts";
import {
  buildConversationLog,
  buildHelpText,
  createInputController,
  type HelpRenderState,
  handleInput,
  type PendingToolCall,
  previewToolRenderLines,
  renderAssistantMessage,
  renderInputArea,
  renderStatusBar,
  renderStreamingResponse,
  renderToolResult,
  type ToolRenderLine,
} from "./ui.ts";

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

function createTestState(): AppState {
  const db = openDatabase(":memory:");
  const cwd = "/tmp/mini-coder-ui-test";
  const session = createSession(db, { cwd });
  return {
    db,
    session,
    model: null,
    effort: "medium",
    messages: [],
    stats: { totalInput: 0, totalOutput: 0, totalCost: 0 },
    agentsMd: [],
    skills: [],
    plugins: [],
    theme: DEFAULT_THEME,
    git: null,
    providers: new Map(),
    oauthCredentials: {},
    cwd,
    canonicalCwd: cwd,
    running: false,
    abortController: null,
    showReasoning: DEFAULT_SHOW_REASONING,
    verbose: DEFAULT_VERBOSE,
  };
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 1_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await Bun.sleep(10);
  }
  throw new Error("Timed out waiting for condition");
}

describe("ui rendering", () => {
  test("reasoning defaults on and verbose defaults off", () => {
    expect(DEFAULT_SHOW_REASONING).toBe(true);
    expect(DEFAULT_VERBOSE).toBe(false);
  });

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

  test("renderStreamingResponse keeps text and tool output inside one top-level container", () => {
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

    const node = renderStreamingResponse(
      {
        text: "Working...",
        thinking: "",
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

  test("renderStreamingResponse shows streaming thinking when reasoning is enabled", () => {
    const node = renderStreamingResponse(
      {
        text: "",
        thinking: "Reasoning in progress",
        pendingToolCalls: [],
      },
      {
        ...RENDER_OPTS,
        showReasoning: true,
      },
    );
    const text = collectText(node);

    expect(text).toContain("Reasoning in progress");
  });

  test("renderStreamingResponse shows partial tool output before the tool finishes", () => {
    const node = renderStreamingResponse(
      {
        text: "",
        thinking: "",
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

  test("/help appends a persisted UI message to the conversation log", () => {
    const state = createTestState();

    try {
      handleInput("/help", state);
      const logText = collectText({
        type: "vstack",
        props: {},
        children: buildConversationLog(state),
      });

      expect(state.messages).toHaveLength(1);
      expect(state.messages[0]?.role).toBe("ui");
      expect(logText.some((line) => line.includes("Commands:"))).toBe(true);
    } finally {
      state.db.close();
    }
  });

  test("completed assistant messages remain visible after a turn finishes", async () => {
    const faux = registerFauxProvider();
    const state = createTestState();
    const originalPath = process.env.PATH;
    process.env.PATH = `${process.env.PATH ?? ""}:/usr/bin:/bin`;
    state.cwd = process.cwd();
    state.canonicalCwd = process.cwd();
    state.model = faux.getModel();
    faux.setResponses([fauxAssistantMessage("Done.")]);

    try {
      handleInput("hello", state);
      await waitFor(() =>
        loadMessages(state.db, state.session.id).some(
          (message) => message.role === "assistant",
        ),
      );

      expect(
        state.messages.some((message) => message.role === "assistant"),
      ).toBe(true);
      const logText = collectText({
        type: "vstack",
        props: {},
        children: buildConversationLog(state),
      });
      expect(logText).toContain("Done.");
    } finally {
      process.env.PATH = originalPath;
      faux.unregister();
      state.db.close();
    }
  });

  test("renderInputArea reuses stable TextInput handlers from the input controller", () => {
    const state = createTestState();

    try {
      const controller = createInputController(state);
      const first = renderInputArea(state.theme, controller);
      const second = renderInputArea(state.theme, controller);

      expect(first.type).toBe("vstack");
      expect(second.type).toBe("vstack");
      if (first.type !== "vstack" || second.type !== "vstack") {
        throw new Error("Expected input area wrappers to be VStack nodes");
      }

      const firstInput = first.children[0];
      const secondInput = second.children[0];
      expect(firstInput?.type).toBe("textinput");
      expect(secondInput?.type).toBe("textinput");
      if (!firstInput || !secondInput) {
        throw new Error("Expected text input children to exist");
      }
      if (firstInput.type !== "textinput" || secondInput.type !== "textinput") {
        throw new Error("Expected text input child nodes");
      }

      expect(firstInput.props.placeholder?.props.fgColor).toBe(
        state.theme.mutedText,
      );
      expect(firstInput.props.onChange).toBe(controller.onChange);
      expect(firstInput.props.onFocus).toBe(controller.onFocus);
      expect(firstInput.props.onBlur).toBe(controller.onBlur);
      expect(firstInput.props.onKeyPress).toBe(controller.onKeyPress);
      expect(secondInput.props.onChange).toBe(firstInput.props.onChange);
      expect(secondInput.props.onFocus).toBe(firstInput.props.onFocus);
      expect(secondInput.props.onBlur).toBe(firstInput.props.onBlur);
      expect(secondInput.props.onKeyPress).toBe(firstInput.props.onKeyPress);
    } finally {
      state.db.close();
    }
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

  test("renderStatusBar uses themed accent colors for git and model info", () => {
    const faux = registerFauxProvider();
    const state = createTestState();
    state.model = faux.getModel();
    state.git = {
      root: state.cwd,
      branch: "main",
      staged: 1,
      modified: 2,
      untracked: 3,
      ahead: 4,
      behind: 0,
    };
    state.theme = {
      ...DEFAULT_THEME,
      accentText: "color04",
      secondaryAccentText: "color05",
      statusText: undefined,
    } satisfies Theme;

    try {
      const node = renderStatusBar(state);

      expect(node.type).toBe("vstack");
      if (node.type !== "vstack") {
        throw new Error("Expected status bar to be a VStack");
      }
      expect(node.props.fgColor).toBeUndefined();

      const gitNode = findTextNode(node, "main +1 ~2 ?3 ▲ 4");
      const modelNode = findTextNode(
        node,
        `${state.model.provider}/${state.model.id} · med`,
      );
      expect(gitNode).not.toBeNull();
      expect(modelNode).not.toBeNull();
      if (!gitNode || !modelNode) {
        throw new Error("Expected git and model text nodes");
      }
      if (gitNode.type !== "text" || modelNode.type !== "text") {
        throw new Error("Expected git and model nodes to be text");
      }
      expect(gitNode.props.fgColor).toBe(state.theme.secondaryAccentText);
      expect(modelNode.props.fgColor).toBe(state.theme.accentText);
    } finally {
      faux.unregister();
      state.db.close();
    }
  });

  test("buildHelpText includes current reasoning and verbose state", () => {
    const helpState: HelpRenderState = {
      providers: new Map(),
      model: null,
      agentsMd: [],
      skills: [],
      plugins: [],
      showReasoning: DEFAULT_SHOW_REASONING,
      verbose: false,
    };

    const text = buildHelpText(helpState);

    expect(text).toContain(
      `/reasoning  Toggle thinking display (currently ${DEFAULT_SHOW_REASONING ? "on" : "off"})`,
    );
    expect(text).toContain("/verbose  Toggle full output (currently off)");
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
