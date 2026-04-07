import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ContainerNode, Node } from "@cel-tui/types";
import type { AssistantMessage, Model } from "@mariozechner/pi-ai";
import {
  createAssistantMessageEventStream,
  fauxAssistantMessage,
  fauxText,
  fauxThinking,
  fauxToolCall,
  registerApiProvider,
  registerFauxProvider,
  unregisterApiProviders,
} from "@mariozechner/pi-ai";
import type { AppState } from "./index.ts";
import {
  appendPromptHistory,
  createSession,
  createUiMessage,
  loadMessages,
  openDatabase,
} from "./session.ts";
import {
  DEFAULT_SHOW_REASONING,
  DEFAULT_VERBOSE,
  loadSettings,
} from "./settings.ts";
import { DEFAULT_THEME, type Theme } from "./theme.ts";
import {
  applyEffortSelection,
  applyModelSelection,
  buildConversationLog,
  buildHelpText,
  createInputController,
  type HelpRenderState,
  handleInput,
  type InputController,
  type PendingToolCall,
  previewToolRenderLines,
  renderActiveOverlay,
  renderAssistantMessage,
  renderBaseLayout,
  renderInputArea,
  renderStatusBar,
  renderStreamingResponse,
  renderToolResult,
  resetUiState,
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

function findNodeWithKeyPress(node: Node | null): ContainerNode | null {
  if (!node || node.type === "textinput" || node.type === "text") {
    return null;
  }
  if (typeof node.props.onKeyPress === "function") {
    return node;
  }
  for (const child of node.children) {
    const found = findNodeWithKeyPress(child);
    if (found) {
      return found;
    }
  }
  return null;
}

const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "mini-coder-ui-test-"));
  tempDirs.push(dir);
  return dir;
}

function countSessions(state: Pick<AppState, "db">): number {
  const row = state.db
    .query<{ count: number }, []>("SELECT COUNT(*) as count FROM sessions")
    .get();
  return row?.count ?? 0;
}

function createTestState(): AppState {
  const db = openDatabase(":memory:");
  const cwd = "/tmp/mini-coder-ui-test";
  const settingsPath = join(createTempDir(), "settings.json");
  return {
    db,
    session: null,
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
    settings: {},
    settingsPath,
    cwd,
    canonicalCwd: cwd,
    running: false,
    abortController: null,
    showReasoning: DEFAULT_SHOW_REASONING,
    verbose: DEFAULT_VERBOSE,
  };
}

function makeAssistantWithUsage(
  text: string,
  usage: Partial<ReturnType<typeof fauxAssistantMessage>["usage"]>,
) {
  const message = fauxAssistantMessage(text);
  message.usage = {
    input: 100,
    output: 50,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 150,
    cost: {
      input: 0.001,
      output: 0.002,
      cacheRead: 0,
      cacheWrite: 0,
      total: 0.003,
    },
    ...usage,
  };
  return message;
}

afterEach(() => {
  resetUiState();
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

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

async function stopRunningTurn(
  state: Pick<AppState, "running" | "abortController">,
): Promise<void> {
  if (!state.running || !state.abortController) {
    return;
  }

  state.abortController.abort();
  try {
    await waitFor(() => !state.running);
  } catch {
    // Ignore cleanup timeouts so test failures surface the original cause.
  }
}

describe("ui rendering", () => {
  test("reasoning defaults on and verbose defaults off", () => {
    expect(DEFAULT_SHOW_REASONING).toBe(true);
    expect(DEFAULT_VERBOSE).toBe(false);
  });

  test("/reasoning toggles the UI state and persists it", () => {
    const state = createTestState();

    try {
      expect(state.showReasoning).toBe(true);

      handleInput("/reasoning", state);

      expect(state.showReasoning).toBe(false);
      expect(state.settings.showReasoning).toBe(false);
      expect(loadSettings(state.settingsPath)).toEqual({
        showReasoning: false,
      });
    } finally {
      state.db.close();
    }
  });

  test("/verbose toggles the UI state and persists it", () => {
    const state = createTestState();

    try {
      expect(state.verbose).toBe(false);

      handleInput("/verbose", state);

      expect(state.verbose).toBe(true);
      expect(state.settings.verbose).toBe(true);
      expect(loadSettings(state.settingsPath)).toEqual({ verbose: true });
    } finally {
      state.db.close();
    }
  });

  test("applyModelSelection updates the active model and persists it", () => {
    const faux = registerFauxProvider();
    const state = createTestState();
    const model = faux.getModel();

    try {
      applyModelSelection(state, model);

      expect(state.model).toBe(model);
      expect(state.settings.defaultModel).toBe(`${model.provider}/${model.id}`);
      expect(loadSettings(state.settingsPath)).toEqual({
        defaultModel: `${model.provider}/${model.id}`,
      });
    } finally {
      faux.unregister();
      state.db.close();
    }
  });

  test("applyEffortSelection updates the active effort and persists it", () => {
    const state = createTestState();

    try {
      applyEffortSelection(state, "xhigh");

      expect(state.effort).toBe("xhigh");
      expect(state.settings.defaultEffort).toBe("xhigh");
      expect(loadSettings(state.settingsPath)).toEqual({
        defaultEffort: "xhigh",
      });
    } finally {
      state.db.close();
    }
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

  test("/help before the first user message does not create a session", () => {
    const state = createTestState();

    try {
      handleInput("/help", state);
      const logText = collectText({
        type: "vstack",
        props: {},
        children: buildConversationLog(state),
      });

      expect(state.session).toBeNull();
      expect(countSessions(state)).toBe(0);
      expect(state.messages).toHaveLength(1);
      expect(state.messages[0]?.role).toBe("ui");
      expect(logText.some((line) => line.includes("Commands:"))).toBe(true);
    } finally {
      state.db.close();
    }
  });

  test("first user message creates the session lazily", async () => {
    const faux = registerFauxProvider();
    const state = createTestState();
    const originalPath = process.env.PATH;
    process.env.PATH = `${process.env.PATH ?? ""}:/usr/bin:/bin`;
    state.cwd = process.cwd();
    state.canonicalCwd = process.cwd();
    state.model = faux.getModel();
    faux.setResponses([fauxAssistantMessage("Done.")]);

    try {
      expect(state.session).toBeNull();
      expect(countSessions(state)).toBe(0);

      handleInput("hello", state);

      await waitFor(() => state.session !== null);
      expect(countSessions(state)).toBe(1);

      const sessionId = state.session?.id;
      if (!sessionId) {
        throw new Error("Expected a session to be created");
      }

      await waitFor(() =>
        loadMessages(state.db, sessionId).some(
          (message) => message.role === "assistant",
        ),
      );
    } finally {
      await stopRunningTurn(state);
      process.env.PATH = originalPath;
      faux.unregister();
      state.db.close();
    }
  });

  test("submitted prompts are stored as raw global input-history entries", async () => {
    const faux = registerFauxProvider();
    const state = createTestState();
    const originalPath = process.env.PATH;
    process.env.PATH = `${process.env.PATH ?? ""}:/usr/bin:/bin`;
    state.cwd = process.cwd();
    state.canonicalCwd = process.cwd();
    state.model = faux.getModel();
    faux.setResponses([fauxAssistantMessage("Done.")]);

    try {
      handleInput("  hello from history  ", state);

      await waitFor(() => state.session !== null);
      const rows = state.db
        .query<
          { text: string; cwd: string; session_id: string | null },
          []
        >("SELECT text, cwd, session_id FROM prompt_history ORDER BY id DESC LIMIT 1")
        .all();

      expect(rows).toHaveLength(1);
      expect(rows[0]?.text).toBe("  hello from history  ");
      expect(rows[0]?.cwd).toBe(state.cwd);
      expect(rows[0]?.session_id).toBe(state.session?.id ?? null);

      await waitFor(() =>
        state.messages.some((message) => message.role === "assistant"),
      );
    } finally {
      await stopRunningTurn(state);
      process.env.PATH = originalPath;
      faux.unregister();
      state.db.close();
    }
  });

  test("/new clears the active session and defers replacement session creation", async () => {
    const faux = registerFauxProvider();
    const state = createTestState();
    const originalPath = process.env.PATH;
    process.env.PATH = `${process.env.PATH ?? ""}:/usr/bin:/bin`;
    state.cwd = process.cwd();
    state.canonicalCwd = process.cwd();
    state.model = faux.getModel();
    const previousSession = createSession(state.db, {
      cwd: state.canonicalCwd,
    });
    state.session = previousSession;
    faux.setResponses([fauxAssistantMessage("Fresh session.")]);

    try {
      expect(countSessions(state)).toBe(1);

      handleInput("/new", state);

      expect(state.session).toBeNull();
      expect(state.messages).toEqual([]);
      expect(state.stats).toEqual({
        totalInput: 0,
        totalOutput: 0,
        totalCost: 0,
      });
      expect(countSessions(state)).toBe(1);

      handleInput("hello again", state);

      await waitFor(() => state.session !== null);
      expect(countSessions(state)).toBe(2);
      expect(state.session?.id).not.toBe(previousSession.id);

      const sessionId = state.session?.id;
      if (!sessionId) {
        throw new Error("Expected a replacement session to be created");
      }

      await waitFor(() =>
        loadMessages(state.db, sessionId).some(
          (message) => message.role === "assistant",
        ),
      );
    } finally {
      await stopRunningTurn(state);
      process.env.PATH = originalPath;
      faux.unregister();
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
      await waitFor(() => state.session !== null);
      const sessionId = state.session?.id;
      if (!sessionId) {
        throw new Error("Expected a session to be created");
      }
      await waitFor(() =>
        loadMessages(state.db, sessionId).some(
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
      await stopRunningTurn(state);
      process.env.PATH = originalPath;
      faux.unregister();
      state.db.close();
    }
  });

  test("completed assistant text stays visible while a tool is running", async () => {
    const faux = registerFauxProvider();
    const state = createTestState();
    const originalPath = process.env.PATH;
    process.env.PATH = `${process.env.PATH ?? ""}:/usr/bin:/bin`;
    state.cwd = process.cwd();
    state.canonicalCwd = process.cwd();
    state.model = faux.getModel();
    faux.setResponses([
      fauxAssistantMessage(
        [
          fauxText("I'll inspect the command output first."),
          fauxToolCall("shell", { command: "sleep 0.2; echo tool-output" }),
        ],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("Done."),
    ]);

    try {
      handleInput("hello", state);

      await waitFor(() => {
        const logText = collectText({
          type: "vstack",
          props: {},
          children: buildConversationLog(state),
        });
        return logText.includes("Running...");
      });

      const logText = collectText({
        type: "vstack",
        props: {},
        children: buildConversationLog(state),
      });

      expect(logText).toContain("I'll inspect the command output first.");
      expect(logText).toContain("$ sleep 0.2; echo tool-output");
      expect(logText).toContain("Running...");
    } finally {
      await stopRunningTurn(state);
      process.env.PATH = originalPath;
      faux.unregister();
      state.db.close();
    }
  });

  test("completed tool results stay visible before the full loop finishes", async () => {
    const api = "ui-streaming-tool-result-test";
    const sourceId = "ui-streaming-tool-result-test-source";
    const model: Model<string> = {
      id: "ui-streaming-tool-result-model",
      name: "UI Streaming Tool Result Model",
      api,
      provider: "test",
      baseUrl: "http://localhost:0",
      reasoning: true,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128000,
      maxTokens: 4096,
    };

    let callCount = 0;
    const buildProviderStream = () => {
      callCount += 1;
      const stream = createAssistantMessageEventStream();

      if (callCount === 1) {
        const message: AssistantMessage = {
          role: "assistant",
          content: [fauxToolCall("shell", { command: "echo tool-output" })],
          api,
          provider: model.provider,
          model: model.id,
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
          timestamp: Date.now(),
        };

        queueMicrotask(() => {
          stream.push({
            type: "done",
            reason: "toolUse",
            message,
          });
          stream.end(message);
        });

        return stream;
      }

      const partial: AssistantMessage = {
        role: "assistant",
        content: [fauxText("Done streaming")],
        api,
        provider: model.provider,
        model: model.id,
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
        stopReason: "stop",
        timestamp: Date.now(),
      };
      const finalMessage: AssistantMessage = { ...partial };

      queueMicrotask(() => {
        stream.push({
          type: "text_delta",
          contentIndex: 0,
          delta: "Done streaming",
          partial,
        });
        setTimeout(() => {
          stream.push({
            type: "done",
            reason: "stop",
            message: finalMessage,
          });
          stream.end(finalMessage);
        }, 200);
      });

      return stream;
    };

    registerApiProvider(
      {
        api,
        stream: (_model, _context, _options) => buildProviderStream(),
        streamSimple: (_model, _context, _options) => buildProviderStream(),
      },
      sourceId,
    );

    const state = createTestState();
    const originalPath = process.env.PATH;
    process.env.PATH = `${process.env.PATH ?? ""}:/usr/bin:/bin`;
    state.cwd = process.cwd();
    state.canonicalCwd = process.cwd();
    state.model = model;

    try {
      handleInput("hello", state);

      await waitFor(() => {
        const logText = collectText({
          type: "vstack",
          props: {},
          children: buildConversationLog(state),
        });
        return (
          state.running &&
          logText.includes("tool-output") &&
          logText.includes("Done streaming")
        );
      });

      const logText = collectText({
        type: "vstack",
        props: {},
        children: buildConversationLog(state),
      });

      expect(logText).toContain("$ echo tool-output");
      expect(logText).toContain("tool-output");
      expect(logText).toContain("Done streaming");
    } finally {
      await stopRunningTurn(state);
      process.env.PATH = originalPath;
      unregisterApiProviders(sourceId);
      state.db.close();
    }
  });

  test("renderInputArea returns a direct TextInput with stable handlers", () => {
    const state = createTestState();

    try {
      const controller = createInputController(state);
      const firstInput = renderInputArea(state.theme, controller);
      const secondInput = renderInputArea(state.theme, controller);

      expect(firstInput.type).toBe("textinput");
      expect(secondInput.type).toBe("textinput");
      if (firstInput.type !== "textinput" || secondInput.type !== "textinput") {
        throw new Error("Expected direct TextInput nodes");
      }

      expect(firstInput.props.placeholder?.props.fgColor).toBe(
        state.theme.mutedText,
      );
      expect(firstInput.props.padding).toEqual({ x: 1 });
      expect(firstInput.props.minHeight).toBe(2);
      expect(firstInput.props.maxHeight).toBe(10);
      expect(firstInput.props.onChange).toBe(controller.onChange);
      expect(firstInput.props.onFocus).toBe(controller.onFocus);
      expect(firstInput.props.onBlur).toBe(controller.onBlur);
      expect(firstInput.props.onKeyPress).toBe(controller.onKeyPress);
      expect(secondInput.props.padding).toEqual(firstInput.props.padding);
      expect(secondInput.props.minHeight).toBe(firstInput.props.minHeight);
      expect(secondInput.props.maxHeight).toBe(firstInput.props.maxHeight);
      expect(secondInput.props.onChange).toBe(firstInput.props.onChange);
      expect(secondInput.props.onFocus).toBe(firstInput.props.onFocus);
      expect(secondInput.props.onBlur).toBe(firstInput.props.onBlur);
      expect(secondInput.props.onKeyPress).toBe(firstInput.props.onKeyPress);
    } finally {
      state.db.close();
    }
  });

  test("Ctrl+R opens input history with newest prompts first", () => {
    const state = createTestState();

    try {
      appendPromptHistory(state.db, {
        text: "older prompt",
        cwd: "/tmp/older",
      });
      appendPromptHistory(state.db, {
        text: "newest prompt",
        cwd: "/tmp/newer",
      });

      const controller = createInputController(state);
      const base = renderBaseLayout(state, 80, controller);

      expect(base.type).toBe("vstack");
      if (base.type !== "vstack") {
        throw new Error("Expected base layout to be a vstack");
      }

      base.props.onKeyPress?.("ctrl+r");

      const overlay = renderActiveOverlay(state);
      const text = collectText(overlay);
      const newestIndex = text.findIndex((line) =>
        line.includes("newest prompt"),
      );
      const olderIndex = text.findIndex((line) =>
        line.includes("older prompt"),
      );

      expect(overlay).not.toBeNull();
      expect(text).toContain("Input history");
      expect(newestIndex).toBeGreaterThan(-1);
      expect(olderIndex).toBeGreaterThan(-1);
      expect(newestIndex).toBeLessThan(olderIndex);
    } finally {
      state.db.close();
    }
  });

  test("selecting input history restores the exact raw prompt into the input", () => {
    const state = createTestState();
    const rawPrompt = "first line\nsecond line";

    try {
      appendPromptHistory(state.db, {
        text: "older prompt",
        cwd: "/tmp/older",
      });
      appendPromptHistory(state.db, {
        text: rawPrompt,
        cwd: state.cwd,
      });

      const controller = createInputController(state);
      const base = renderBaseLayout(state, 80, controller);
      if (base.type !== "vstack") {
        throw new Error("Expected base layout to be a vstack");
      }

      base.props.onKeyPress?.("ctrl+r");

      const overlay = renderActiveOverlay(state);
      const selectNode = findNodeWithKeyPress(overlay);

      expect(selectNode).not.toBeNull();
      if (!selectNode) {
        throw new Error("Expected overlay to contain a Select root");
      }

      selectNode.props.onKeyPress?.("enter");

      expect(renderActiveOverlay(state)).toBeNull();
      const input = renderInputArea(state.theme, controller);
      if (input.type !== "textinput") {
        throw new Error("Expected input area to render a TextInput");
      }
      expect(input.props.value).toBe(rawPrompt);
    } finally {
      state.db.close();
    }
  });

  test("dismissing input history keeps the current draft unchanged", () => {
    const state = createTestState();
    const draft = "draft prompt";

    try {
      appendPromptHistory(state.db, {
        text: "saved prompt",
        cwd: state.cwd,
      });

      const controller = createInputController(state);
      controller.onChange(draft);

      const base = renderBaseLayout(state, 80, controller);
      if (base.type !== "vstack") {
        throw new Error("Expected base layout to be a vstack");
      }

      base.props.onKeyPress?.("ctrl+r");

      const overlay = renderActiveOverlay(state);
      const selectNode = findNodeWithKeyPress(overlay);

      expect(selectNode).not.toBeNull();
      if (!selectNode) {
        throw new Error("Expected overlay to contain a Select root");
      }

      selectNode.props.onBlur?.();

      expect(renderActiveOverlay(state)).toBeNull();
      const input = renderInputArea(state.theme, controller);
      if (input.type !== "textinput") {
        throw new Error("Expected input area to render a TextInput");
      }
      expect(input.props.value).toBe(draft);
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

  test("renderStatusBar renders a one-line status bar with outer primary pills and inner secondary pills", () => {
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
      statusText: "color15",
      statusPrimaryBg: "color04",
      statusSecondaryBg: "color08",
    } satisfies Theme;

    try {
      const node = renderStatusBar(state);

      expect(node.type).toBe("hstack");
      if (node.type !== "hstack") {
        throw new Error("Expected status bar to be an HStack");
      }
      expect(node.props.height).toBe(1);
      expect(node.props.padding).toEqual({ x: 1 });

      const [modelPill, cwdPill, spacer, gitPill, usagePill] = node.children;
      expect(modelPill?.type).toBe("hstack");
      expect(cwdPill?.type).toBe("hstack");
      expect(gitPill?.type).toBe("hstack");
      expect(usagePill?.type).toBe("hstack");
      if (
        !modelPill ||
        !cwdPill ||
        !spacer ||
        !gitPill ||
        !usagePill ||
        modelPill.type !== "hstack" ||
        cwdPill.type !== "hstack" ||
        gitPill.type !== "hstack" ||
        usagePill.type !== "hstack"
      ) {
        throw new Error("Expected status pills around a spacer in one row");
      }

      expect(modelPill.props.bgColor).toBe(state.theme.statusPrimaryBg);
      expect(cwdPill.props.bgColor).toBe(state.theme.statusSecondaryBg);
      expect(gitPill.props.bgColor).toBe(state.theme.statusSecondaryBg);
      expect(usagePill.props.bgColor).toBe(state.theme.statusPrimaryBg);
      expect(modelPill.props.padding).toEqual({ x: 1 });
      expect(cwdPill.props.padding).toEqual({ x: 1 });
      expect(gitPill.props.padding).toEqual({ x: 1 });
      expect(usagePill.props.padding).toEqual({ x: 1 });

      const cwdNode = findTextNode(cwdPill, state.cwd);
      const gitNode = findTextNode(gitPill, "main +1 ~2 ?3 ▲ 4");
      const modelNode = findTextNode(
        modelPill,
        `${state.model.provider}/${state.model.id} · med`,
      );
      expect(cwdNode).not.toBeNull();
      expect(gitNode).not.toBeNull();
      expect(modelNode).not.toBeNull();
      if (!cwdNode || !gitNode || !modelNode) {
        throw new Error("Expected status pill text nodes");
      }
      if (
        cwdNode.type !== "text" ||
        gitNode.type !== "text" ||
        modelNode.type !== "text"
      ) {
        throw new Error("Expected status pill content to be text nodes");
      }
      expect(cwdNode.props.fgColor).toBe(state.theme.statusText);
      expect(gitNode.props.fgColor).toBe(state.theme.statusText);
      expect(modelNode.props.fgColor).toBe(state.theme.statusText);
      expect(collectText(usagePill).join("")).toContain("in:0 out:0 ·");
    } finally {
      faux.unregister();
      state.db.close();
    }
  });

  test("renderBaseLayout keeps a single divider between the log and input", () => {
    const state = createTestState();
    const controller: InputController = {
      onChange: () => {},
      onFocus: () => {},
      onBlur: () => {},
      onKeyPress: () => undefined,
    };

    try {
      const node = renderBaseLayout(state, 80, controller);

      expect(node.type).toBe("vstack");
      if (node.type !== "vstack") {
        throw new Error("Expected app layout to be a VStack");
      }
      expect(node.children).toHaveLength(4);
      expect(node.children[0]?.type).toBe("vstack");
      expect(node.children[1]?.type).toBe("text");
      expect(node.children[2]?.type).toBe("textinput");
      expect(node.children[3]?.type).toBe("hstack");
    } finally {
      state.db.close();
    }
  });

  test("renderStatusBar estimates context usage from the latest valid assistant usage plus trailing model-visible messages", () => {
    const faux = registerFauxProvider();
    const state = createTestState();
    state.model = {
      ...faux.getModel(),
      contextWindow: 1_000,
    };
    state.messages = [
      { role: "user", content: "first", timestamp: 1 },
      makeAssistantWithUsage("Second.", {
        input: 200,
        output: 50,
        totalTokens: 250,
      }),
      createUiMessage("x".repeat(500)),
      { role: "user", content: "12345678", timestamp: 2 },
      {
        role: "toolResult",
        toolCallId: "tool-1",
        toolName: "shell",
        content: [{ type: "text", text: "done" }],
        isError: false,
        timestamp: 3,
      },
    ];
    state.stats = {
      totalInput: 4_000,
      totalOutput: 2_000,
      totalCost: 1.23,
    };

    try {
      const node = renderStatusBar(state);
      const text = collectText(node);

      expect(text).toContain("in:4.0k out:2.0k · 25.3%/1k · $1.23");
      expect(text).not.toContain("in:4.0k out:2.0k · 75.3%/1k · $1.23");
      expect(text).not.toContain("in:4.0k out:2.0k · 25.0%/1k · $1.23");
    } finally {
      faux.unregister();
      state.db.close();
    }
  });

  test("renderStatusBar estimates context usage before the first assistant response", () => {
    const faux = registerFauxProvider();
    const state = createTestState();
    state.model = {
      ...faux.getModel(),
      contextWindow: 100,
    };
    state.messages = [
      createUiMessage("x".repeat(500)),
      { role: "user", content: "12345678", timestamp: 1 },
    ];

    try {
      const node = renderStatusBar(state);
      const text = collectText(node);

      expect(text).toContain("in:0 out:0 · 2.0%/100 · $0.00");
      expect(text).not.toContain("in:0 out:0 · 127.0%/100 · $0.00");
      expect(text).not.toContain("in:0 out:0 · 0.0%/100 · $0.00");
    } finally {
      faux.unregister();
      state.db.close();
    }
  });

  test("renderStatusBar skips aborted assistant usage as a context anchor", () => {
    const faux = registerFauxProvider();
    const state = createTestState();
    const aborted = makeAssistantWithUsage("abcdefghi", {
      input: 700,
      output: 200,
      totalTokens: 900,
    });
    aborted.stopReason = "aborted";

    state.model = {
      ...faux.getModel(),
      contextWindow: 1_000,
    };
    state.messages = [
      { role: "user", content: "first", timestamp: 1 },
      makeAssistantWithUsage("valid", {
        input: 150,
        output: 50,
        totalTokens: 200,
      }),
      aborted,
      { role: "user", content: "1234", timestamp: 2 },
    ];

    try {
      const node = renderStatusBar(state);
      const text = collectText(node);

      expect(text).toContain("in:0 out:0 · 20.4%/1k · $0.00");
      expect(text).not.toContain("in:0 out:0 · 90.0%/1k · $0.00");
    } finally {
      faux.unregister();
      state.db.close();
    }
  });

  test("renderStatusBar falls back to usage components when totalTokens is zero", () => {
    const faux = registerFauxProvider();
    const state = createTestState();
    state.model = {
      ...faux.getModel(),
      contextWindow: 1_000,
    };
    state.messages = [
      makeAssistantWithUsage("fallback", {
        input: 120,
        output: 30,
        cacheRead: 25,
        cacheWrite: 25,
        totalTokens: 0,
      }),
    ];

    try {
      const node = renderStatusBar(state);
      const text = collectText(node);

      expect(text).toContain("in:0 out:0 · 20.0%/1k · $0.00");
      expect(text).not.toContain("in:0 out:0 · 0.0%/1k · $0.00");
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
