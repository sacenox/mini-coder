import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
  loadMessages,
  openDatabase,
} from "./session.ts";
import { DEFAULT_SHOW_REASONING, DEFAULT_VERBOSE } from "./settings.ts";
import { DEFAULT_THEME } from "./theme.ts";
import * as uiModule from "./ui.ts";
import {
  buildConversationLog,
  createInputController,
  handleInput,
  type InputController,
  renderActiveOverlay,
  renderBaseLayout,
  renderInputArea,
  resetUiState,
  suspendToBackground,
} from "./ui.ts";

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
    activeTurnPromise: null,
    showReasoning: DEFAULT_SHOW_REASONING,
    verbose: DEFAULT_VERBOSE,
  };
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
  test("ui.ts keeps command and render helpers private", () => {
    const exports = Object.keys(uiModule);

    expect(exports).not.toContain("applyEffortSelection");
    expect(exports).not.toContain("applyModelSelection");
    expect(exports).not.toContain("buildHelpText");
    expect(exports).not.toContain("formatPromptHistoryPreview");
    expect(exports).not.toContain("formatRelativeDate");
    expect(exports).not.toContain("previewToolRenderLines");
    expect(exports).not.toContain("renderAssistantMessage");
    expect(exports).not.toContain("renderStatusBar");
    expect(exports).not.toContain("renderToolResult");
  });

  test("reasoning defaults on and verbose defaults off", () => {
    expect(DEFAULT_SHOW_REASONING).toBe(true);
    expect(DEFAULT_VERBOSE).toBe(false);
  });

  test("committing a streamed response preserves hidden reasoning placeholder order", async () => {
    const api = "ui-hidden-reasoning-order-test";
    const sourceId = "ui-hidden-reasoning-order-test-source";
    const model: Model<string> = {
      id: "ui-hidden-reasoning-order-model",
      name: "UI Hidden Reasoning Order Model",
      api,
      provider: "test",
      baseUrl: "http://localhost:0",
      reasoning: true,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128000,
      maxTokens: 4096,
    };

    const createFinalMessage = (): AssistantMessage => {
      const message = fauxAssistantMessage([
        fauxText("Before"),
        fauxThinking("line one\nline two"),
        fauxText("After"),
      ]);
      message.api = api;
      message.provider = model.provider;
      message.model = model.id;
      message.usage = {
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
      };
      message.stopReason = "stop";
      message.timestamp = Date.now();
      return message;
    };

    const buildProviderStream = () => {
      const stream = createAssistantMessageEventStream();
      const finalMessage = createFinalMessage();

      queueMicrotask(() => {
        stream.push({
          type: "text_delta",
          contentIndex: 0,
          delta: "Before",
          partial: {
            ...finalMessage,
            content: [fauxText("Before")],
          },
        });
        stream.push({
          type: "thinking_delta",
          contentIndex: 1,
          delta: "line one\nline two",
          partial: {
            ...finalMessage,
            content: [fauxText("Before"), fauxThinking("line one\nline two")],
          },
        });
        stream.push({
          type: "text_delta",
          contentIndex: 2,
          delta: "After",
          partial: {
            ...finalMessage,
            content: [
              fauxText("Before"),
              fauxThinking("line one\nline two"),
              fauxText("After"),
            ],
          },
        });
        setTimeout(() => {
          stream.push({
            type: "done",
            reason: "stop",
            message: finalMessage,
          });
          stream.end(finalMessage);
        }, 50);
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
    state.cwd = process.cwd();
    state.canonicalCwd = process.cwd();
    state.model = model;
    state.showReasoning = false;

    try {
      handleInput("hello", state);

      const streamedLogText: string[] = [];
      await waitFor(() => {
        if (state.messages.some((message) => message.role === "assistant")) {
          return false;
        }
        const logText = collectText({
          type: "vstack",
          props: {},
          children: buildConversationLog(state),
        }).filter(Boolean);
        if (
          logText.includes("Thinking... 2 lines.") &&
          logText.join("").includes("Before") &&
          logText.join("").includes("After")
        ) {
          streamedLogText.splice(0, streamedLogText.length, ...logText);
          return true;
        }
        return false;
      });

      const streamedText = streamedLogText.join("\n");
      expect(streamedText).toBe("hello\nBefore\nThinking... 2 lines.\nAfter");

      await waitFor(() =>
        state.messages.some((message) => message.role === "assistant"),
      );

      const committedLogText = collectText({
        type: "vstack",
        props: {},
        children: buildConversationLog(state),
      }).filter(Boolean);
      expect(committedLogText.join("\n")).toBe(streamedText);
    } finally {
      await stopRunningTurn(state);
      unregisterApiProviders(sourceId);
      state.db.close();
    }
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

  test("empty conversation log renders no splash banner", () => {
    const faux = registerFauxProvider();
    const withoutModel = createTestState();
    const withModel = createTestState();
    withModel.model = faux.getModel();

    try {
      expect(buildConversationLog(withoutModel)).toEqual([]);
      expect(buildConversationLog(withModel)).toEqual([]);
    } finally {
      faux.unregister();
      withoutModel.db.close();
      withModel.db.close();
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

  test("submit/runtime errors are appended to the conversation log and persisted", async () => {
    const api = "ui-submit-error-test";
    const sourceId = "ui-submit-error-test-source";
    const model: Model<string> = {
      id: "ui-submit-error-model",
      name: "UI Submit Error Model",
      api,
      provider: "test",
      baseUrl: "http://localhost:0",
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128000,
      maxTokens: 4096,
    };

    registerApiProvider(
      {
        api,
        stream: () => {
          throw new Error("provider exploded");
        },
        streamSimple: () => {
          throw new Error("provider exploded");
        },
      },
      sourceId,
    );

    const state = createTestState();
    state.cwd = process.cwd();
    state.canonicalCwd = process.cwd();
    state.model = model;

    try {
      handleInput("hello", state);

      await waitFor(() =>
        state.messages.some(
          (message) =>
            message.role === "ui" &&
            message.content === "Submit failed: provider exploded",
        ),
      );
      await waitFor(() => !state.running);

      const sessionId = state.session?.id;
      if (!sessionId) {
        throw new Error("Expected a session to be created");
      }

      const messages = loadMessages(state.db, sessionId);
      expect(messages.map((message) => message.role)).toEqual(["user", "ui"]);
      const uiMessage = messages[1];
      expect(uiMessage?.role).toBe("ui");
      if (!uiMessage || uiMessage.role !== "ui") {
        throw new Error("Expected persisted UI message");
      }
      expect(uiMessage.content).toBe("Submit failed: provider exploded");
    } finally {
      await stopRunningTurn(state);
      unregisterApiProviders(sourceId);
      state.db.close();
    }
  });

  test("/undo waits for an aborted run to settle before deleting the turn", async () => {
    const api = "ui-undo-abort-race-test";
    const sourceId = "ui-undo-abort-race-test-source";
    const model: Model<string> = {
      id: "ui-undo-abort-race-model",
      name: "UI Undo Abort Race Model",
      api,
      provider: "test",
      baseUrl: "http://localhost:0",
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128000,
      maxTokens: 4096,
    };

    const buildAbortMessage = (): AssistantMessage => ({
      role: "assistant",
      content: [],
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
      stopReason: "aborted",
      errorMessage: "aborted",
      timestamp: Date.now(),
    });

    const buildProviderStream = (signal?: AbortSignal) => {
      const stream = createAssistantMessageEventStream();

      queueMicrotask(() => {
        const emitAbort = () => {
          const abortedMessage = buildAbortMessage();
          stream.push({
            type: "error",
            reason: "aborted",
            error: abortedMessage,
          });
          stream.end(abortedMessage);
        };

        if (signal?.aborted) {
          setTimeout(emitAbort, 50);
          return;
        }

        signal?.addEventListener(
          "abort",
          () => {
            setTimeout(emitAbort, 50);
          },
          { once: true },
        );
      });

      return stream;
    };

    registerApiProvider(
      {
        api,
        stream: (_model, _context, options) =>
          buildProviderStream(options?.signal),
        streamSimple: (_model, _context, options) =>
          buildProviderStream(options?.signal),
      },
      sourceId,
    );

    const state = createTestState();
    state.cwd = process.cwd();
    state.canonicalCwd = process.cwd();
    state.model = model;

    try {
      handleInput("hello", state);

      await waitFor(() => state.running && state.session !== null);
      const sessionId = state.session?.id;
      if (!sessionId) {
        throw new Error("Expected a session to be created");
      }

      handleInput("/undo", state);

      await waitFor(() => !state.running);
      await waitFor(() => state.messages.length === 0);

      expect(loadMessages(state.db, sessionId)).toEqual([]);
    } finally {
      await stopRunningTurn(state);
      unregisterApiProviders(sourceId);
      state.db.close();
    }
  });

  test("/skill:name prepends the selected skill body to the submitted user message", async () => {
    const faux = registerFauxProvider();
    const state = createTestState();
    const originalPath = process.env.PATH;
    const skillRoot = createTempDir();
    const skillPath = join(skillRoot, "code-review", "SKILL.md");
    mkdirSync(join(skillRoot, "code-review"), { recursive: true });
    writeFileSync(
      skillPath,
      [
        "---",
        "name: code-review",
        'description: "Review code for issues"',
        "---",
        "# Review Checklist",
        "- Find bugs",
        "- Note missing tests",
        "",
      ].join("\n"),
      "utf-8",
    );
    process.env.PATH = `${process.env.PATH ?? ""}:/usr/bin:/bin`;
    state.cwd = skillRoot;
    state.canonicalCwd = skillRoot;
    state.model = faux.getModel();
    state.skills = [
      {
        name: "code-review",
        description: "Review code for issues",
        path: skillPath,
      },
    ];
    faux.setResponses([fauxAssistantMessage("Done.")]);

    try {
      handleInput("/skill:code-review check the auth module", state);

      await waitFor(() =>
        state.messages.some((message) => message.role === "assistant"),
      );

      const sessionId = state.session?.id;
      if (!sessionId) {
        throw new Error("Expected a session to be created");
      }

      const messages = loadMessages(state.db, sessionId);
      const userMessage = messages.find((message) => message.role === "user");
      if (!userMessage || typeof userMessage.content !== "string") {
        throw new Error("Expected a text user message");
      }

      expect(userMessage.content).toBe(
        "# Review Checklist\n- Find bugs\n- Note missing tests\n\ncheck the auth module",
      );
      expect(userMessage.content).not.toContain("name: code-review");

      const history = state.db
        .query<
          { text: string },
          []
        >("SELECT text FROM prompt_history ORDER BY id DESC LIMIT 1")
        .all();
      expect(history[0]?.text).toBe("/skill:code-review check the auth module");
    } finally {
      await stopRunningTurn(state);
      process.env.PATH = originalPath;
      faux.unregister();
      state.db.close();
    }
  });

  test("image inputs are submitted as ImageContent when the active model supports images", async () => {
    const faux = registerFauxProvider();
    const state = createTestState();
    const originalPath = process.env.PATH;
    const cwd = createTempDir();
    const imagePath = join(cwd, "diagram.png");
    writeFileSync(imagePath, Buffer.from("fake-png-data"));
    process.env.PATH = `${process.env.PATH ?? ""}:/usr/bin:/bin`;
    state.cwd = cwd;
    state.canonicalCwd = cwd;
    state.model = {
      ...faux.getModel(),
      input: ["text", "image"],
    };
    faux.setResponses([fauxAssistantMessage("Looks good.")]);

    try {
      handleInput("diagram.png", state);

      await waitFor(() =>
        state.messages.some((message) => message.role === "assistant"),
      );

      const sessionId = state.session?.id;
      if (!sessionId) {
        throw new Error("Expected a session to be created");
      }

      const messages = loadMessages(state.db, sessionId);
      const userMessage = messages.find((message) => message.role === "user");
      if (!userMessage || typeof userMessage.content === "string") {
        throw new Error("Expected a multipart user message");
      }

      expect(userMessage.content).toEqual([
        { type: "text", text: "diagram.png" },
        {
          type: "image",
          data: Buffer.from("fake-png-data").toString("base64"),
          mimeType: "image/png",
        },
      ]);

      const history = state.db
        .query<
          { text: string },
          []
        >("SELECT text FROM prompt_history ORDER BY id DESC LIMIT 1")
        .all();
      expect(history[0]?.text).toBe("diagram.png");
    } finally {
      await stopRunningTurn(state);
      process.env.PATH = originalPath;
      faux.unregister();
      state.db.close();
    }
  });

  test("/session resumes a stored session even when historical assistant usage is missing", () => {
    const state = createTestState();
    const now = Date.now();
    const session = createSession(state.db, {
      cwd: state.canonicalCwd,
      model: "test/beta",
      effort: "high",
    });

    try {
      state.db.run(
        "INSERT INTO messages (session_id, turn, data, created_at) VALUES (?, ?, ?, ?)",
        [
          session.id,
          1,
          JSON.stringify({
            role: "user",
            content: "historical prompt",
            timestamp: now,
          }),
          now,
        ],
      );
      state.db.run(
        "INSERT INTO messages (session_id, turn, data, created_at) VALUES (?, ?, ?, ?)",
        [
          session.id,
          1,
          JSON.stringify({
            role: "assistant",
            content: [{ type: "text", text: "historical reply" }],
            api: "anthropic-messages",
            provider: "anthropic",
            model: "test/beta",
            stopReason: "stop",
            timestamp: now + 1,
          }),
          now + 1,
        ],
      );
      state.db.run("UPDATE sessions SET updated_at = ? WHERE id = ?", [
        now + 1,
        session.id,
      ]);

      handleInput("/session", state);

      const overlay = renderActiveOverlay(state);
      const selectNode = findNodeWithKeyPress(overlay);

      expect(selectNode).not.toBeNull();
      if (!selectNode) {
        throw new Error("Expected overlay to contain a Select root");
      }

      selectNode.props.onKeyPress?.("enter");

      expect(renderActiveOverlay(state)).toBeNull();
      expect(state.session?.id).toBe(session.id);

      const layout = renderBaseLayout(state, 80, createInputController(state));
      const text = collectText(layout);

      expect(text).toContain("historical prompt");
      expect(text).toContain("historical reply");
    } finally {
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

  test("Tab autocompletes the last file path in normal input mode", () => {
    const state = createTestState();
    const cwd = createTempDir();
    mkdirSync(join(cwd, "src"), { recursive: true });
    writeFileSync(join(cwd, "src", "ui.ts"), "", "utf-8");
    state.cwd = cwd;
    state.canonicalCwd = cwd;

    try {
      const controller = createInputController(state);
      controller.onChange("inspect src/u");

      expect(controller.onKeyPress("tab")).toBe(false);

      const input = renderInputArea(state.theme, controller);
      if (input.type !== "textinput") {
        throw new Error("Expected input area to render a TextInput");
      }
      expect(input.props.value).toBe("inspect src/ui.ts");
      expect(renderActiveOverlay(state)).toBeNull();
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

  test("renderBaseLayout delegates Ctrl+Z to the suspend handler", () => {
    const state = createTestState();
    const controller: InputController = {
      onChange: () => {},
      onFocus: () => {},
      onBlur: () => {},
      onKeyPress: () => undefined,
    };
    let suspended = false;

    try {
      const node = renderBaseLayout(state, 80, controller, () => {
        suspended = true;
      });

      expect(node.type).toBe("vstack");
      if (node.type !== "vstack") {
        throw new Error("Expected app layout to be a VStack");
      }

      node.props.onKeyPress?.("ctrl+z");
      expect(suspended).toBe(true);
    } finally {
      state.db.close();
    }
  });

  test("suspendToBackground stops immediately and resumes on SIGCONT", () => {
    const calls: string[] = [];
    let resumeHandler = (): void => {
      throw new Error(
        "Expected suspendToBackground to register a resume handler",
      );
    };

    suspendToBackground(
      () => {
        calls.push("resume");
      },
      {
        stop: () => {
          calls.push("stop");
        },
        onResume: (handler: () => void) => {
          calls.push("onResume");
          resumeHandler = handler;
        },
        suspend: () => {
          calls.push("suspend");
        },
      },
    );

    expect(calls).toEqual(["stop", "onResume", "suspend"]);
    resumeHandler();
    expect(calls).toEqual(["stop", "onResume", "suspend", "resume"]);
  });
});
