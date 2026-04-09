import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { measureContentHeight, VStack } from "@cel-tui/core";
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
import { getGitState } from "./git.ts";
import type { AppState } from "./index.ts";
import {
  appendMessage,
  appendPromptHistory,
  createSession,
  createUiMessage,
  loadMessages,
  openDatabase,
} from "./session.ts";
import { DEFAULT_SHOW_REASONING, DEFAULT_VERBOSE } from "./settings.ts";
import { DEFAULT_THEME } from "./theme.ts";
import {
  buildConversationLogNodes,
  CONVERSATION_GAP,
} from "./ui/conversation.ts";
import {
  buildConversationLog,
  createInputController,
  handleInput,
  type InputController,
  isQuitInput,
  isQuitKey,
  openInBrowser,
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

function expectTextInput(node: Node): Extract<Node, { type: "textinput" }> {
  if (node.type !== "textinput") {
    throw new Error("Expected input area to render a TextInput");
  }
  return node;
}

function expectVStack(node: Node): ContainerNode {
  if (node.type !== "vstack") {
    throw new Error("Expected app layout to be a vstack");
  }
  return node;
}

function findConversationLogNode(node: Node): ContainerNode {
  const found = findConversationLogNodeOrNull(node);
  if (!found) {
    throw new Error("Expected to find the scrollable conversation log");
  }
  return found;
}

function findConversationLogNodeOrNull(node: Node): ContainerNode | null {
  if (
    node.type === "vstack" &&
    node.props.overflow === "scroll" &&
    node.props.scrollbar === true
  ) {
    return node;
  }
  if (node.type === "text" || node.type === "textinput") {
    return null;
  }
  for (const child of node.children) {
    const nested = findConversationLogNodeOrNull(child);
    if (nested) {
      return nested;
    }
  }
  return null;
}

function getVisibleMessageIndexes(state: AppState): number[] {
  return collectText({
    type: "vstack",
    props: {},
    children: buildConversationLog(state),
  }).flatMap((line) => {
    const match = /^message (\d+)(?:$|\s)/.exec(line);
    return match ? [Number(match[1])] : [];
  });
}

function measureConversationHeight(
  state: Pick<AppState, "messages" | "showReasoning" | "verbose" | "theme">,
  width: number,
  startIndex: number,
): number {
  return measureContentHeight(
    VStack(
      { gap: CONVERSATION_GAP },
      buildConversationLogNodes(
        state,
        {
          isStreaming: false,
          content: [],
          pendingToolResults: [],
        },
        startIndex,
        width,
      ),
    ),
    { width },
  );
}

function createDeferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
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
    await new Promise<void>((resolve) => setImmediate(resolve));
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

  test("isQuitInput matches :q with surrounding whitespace", () => {
    expect(isQuitInput(":q")).toBe(true);
    expect(isQuitInput("  :q")).toBe(true);
    expect(isQuitInput(":q   ")).toBe(true);
    expect(isQuitInput("  :q  ")).toBe(true);
  });

  test("isQuitInput does not match other inputs", () => {
    expect(isQuitInput("")).toBe(false);
    expect(isQuitInput("q")).toBe(false);
    expect(isQuitInput(":q!")).toBe(false);
    expect(isQuitInput(":quit")).toBe(false);
    expect(isQuitInput(":q and something")).toBe(false);
  });

  test("isQuitKey matches always-on quit keys", () => {
    expect(isQuitKey("ctrl+c", "")).toBe(true);
    expect(isQuitKey("ctrl+c", "draft text")).toBe(true);
  });

  test("isQuitKey matches empty-input quit keys only when input is empty", () => {
    expect(isQuitKey("ctrl+d", "")).toBe(true);
    expect(isQuitKey("ctrl+d", " ")).toBe(false);
    expect(isQuitKey("ctrl+d", "draft text")).toBe(false);
  });

  test("isQuitKey ignores non-quit keys", () => {
    expect(isQuitKey("enter", "")).toBe(false);
    expect(isQuitKey("escape", "")).toBe(false);
  });

  test("openInBrowser launches the platform opener with argv instead of a shell command", () => {
    const calls: {
      command: string;
      args: string[];
      options: { detached: boolean; stdio: "ignore" };
    }[] = [];
    let unrefCalled = false;
    const url = "https://example.com/$(printf injected)";

    openInBrowser(url, {
      platform: "linux",
      spawn: (command, args, options) => {
        calls.push({ command, args, options });
        return {
          unref: () => {
            unrefCalled = true;
          },
        };
      },
    });

    expect(calls).toEqual([
      {
        command: "xdg-open",
        args: [url],
        options: { detached: true, stdio: "ignore" },
      },
    ]);
    expect(unrefCalled).toBe(true);
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

    const finishStream = createDeferred<void>();
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
        void finishStream.promise.then(() => {
          stream.push({
            type: "done",
            reason: "stop",
            message: finalMessage,
          });
          stream.end(finalMessage);
        });
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

      finishStream.resolve();
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

  test("completed turns keep in-memory messages and stats authoritative", async () => {
    const api = "ui-authoritative-state-test";
    const sourceId = "ui-authoritative-state-test-source";
    const model: Model<string> = {
      id: "ui-authoritative-state-model",
      name: "UI Authoritative State Model",
      api,
      provider: "test",
      baseUrl: "http://localhost:0",
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128000,
      maxTokens: 4096,
    };

    const releaseStream = createDeferred<void>();
    const finalMessage: AssistantMessage = {
      role: "assistant",
      content: [fauxText("Done.")],
      api,
      provider: model.provider,
      model: model.id,
      usage: {
        input: 123,
        output: 45,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 168,
        cost: {
          input: 0.001,
          output: 0.002,
          cacheRead: 0,
          cacheWrite: 0,
          total: 0.003,
        },
      },
      stopReason: "stop",
      timestamp: Date.now(),
    };

    const buildProviderStream = () => {
      const stream = createAssistantMessageEventStream();

      queueMicrotask(() => {
        void releaseStream.promise.then(() => {
          stream.push({
            type: "done",
            reason: "stop",
            message: finalMessage,
          });
          stream.end(finalMessage);
        });
      });

      return stream;
    };

    registerApiProvider(
      {
        api,
        stream: () => buildProviderStream(),
        streamSimple: () => buildProviderStream(),
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

      appendMessage(state.db, sessionId, createUiMessage("Injected from DB"));
      releaseStream.resolve();

      await waitFor(() => !state.running);
      await waitFor(() =>
        state.messages.some(
          (message) =>
            message.role === "assistant" &&
            typeof message.content !== "string" &&
            message.content[0]?.type === "text" &&
            message.content[0].text === "Done.",
        ),
      );

      expect(state.messages.map((message) => message.role)).toEqual([
        "user",
        "assistant",
      ]);
      expect(state.stats).toEqual({
        totalInput: 123,
        totalOutput: 45,
        totalCost: 0.003,
      });

      const persistedRoles = loadMessages(state.db, sessionId).map(
        (message) => message.role,
      );
      expect(persistedRoles).toEqual(["user", "ui", "assistant"]);
    } finally {
      await stopRunningTurn(state);
      unregisterApiProviders(sourceId);
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

    const abortObserved = createDeferred<void>();
    const releaseAbort = createDeferred<void>();
    const buildProviderStream = (signal?: AbortSignal) => {
      const stream = createAssistantMessageEventStream();

      queueMicrotask(() => {
        const emitAbort = () => {
          abortObserved.resolve();
          void releaseAbort.promise.then(() => {
            const abortedMessage = buildAbortMessage();
            stream.push({
              type: "error",
              reason: "aborted",
              error: abortedMessage,
            });
            stream.end(abortedMessage);
          });
        };

        if (signal?.aborted) {
          emitAbort();
          return;
        }

        signal?.addEventListener("abort", emitAbort, { once: true });
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

      await abortObserved.promise;
      expect(state.running).toBe(true);

      releaseAbort.resolve();
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
          fauxToolCall("shell", { command: "echo tool-output; sleep 0.2" }),
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
        return (
          state.running &&
          logText.includes("[shell ->]") &&
          logText.includes("echo tool-output; sleep 0.2") &&
          logText.includes("tool-output")
        );
      });

      const logText = collectText({
        type: "vstack",
        props: {},
        children: buildConversationLog(state),
      });

      expect(logText).toContain("I'll inspect the command output first.");
      expect(logText.filter((line) => line === "[shell ->]")).toHaveLength(1);
      expect(
        logText.filter((line) => line === "echo tool-output; sleep 0.2"),
      ).toHaveLength(1);
      expect(logText).toContain("tool-output");
      expect(logText).not.toContain("Exit code: 0");
      expect(logText).not.toContain("Running...");
    } finally {
      await stopRunningTurn(state);
      process.env.PATH = originalPath;
      faux.unregister();
      state.db.close();
    }
  });

  test("git status refreshes after a completed turn mutates the repo", async () => {
    const faux = registerFauxProvider();
    const state = createTestState();
    const repo = createTempDir();
    const originalPath = process.env.PATH;
    process.env.PATH = `${process.env.PATH ?? ""}:/usr/bin:/bin`;

    const runGit = (...args: string[]) => {
      const result = Bun.spawnSync(["git", ...args], {
        cwd: repo,
        stdout: "pipe",
        stderr: "pipe",
      });
      if (result.exitCode !== 0) {
        throw new Error(
          `git ${args.join(" ")} failed: ${result.stderr.toString()}`,
        );
      }
    };

    runGit("init");
    runGit("config", "user.name", "Mini Coder");
    runGit("config", "user.email", "mini-coder@example.com");
    writeFileSync(join(repo, "tracked.txt"), "initial\n", "utf-8");
    runGit("add", "tracked.txt");
    runGit("commit", "-m", "init");

    state.cwd = repo;
    state.canonicalCwd = repo;
    state.model = faux.getModel();
    state.git = await getGitState(repo);
    faux.setResponses([
      fauxAssistantMessage(
        [
          fauxToolCall("shell", {
            command: "printf 'updated\\n' >> tracked.txt",
          }),
        ],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("Done."),
    ]);

    try {
      expect(state.git?.modified).toBe(0);

      handleInput("update the repo", state);

      await waitFor(() => state.running);
      await waitFor(() => !state.running);
      expect(state.git?.modified).toBe(1);
    } finally {
      await stopRunningTurn(state);
      process.env.PATH = originalPath;
      faux.unregister();
      state.db.close();
    }
  });

  test("streamed tool call arguments stay visible before execution begins", async () => {
    const api = "ui-streaming-toolcall-test";
    const sourceId = "ui-streaming-toolcall-test-source";
    const model: Model<string> = {
      id: "ui-streaming-toolcall-model",
      name: "UI Streaming Tool Call Model",
      api,
      provider: "test",
      baseUrl: "http://localhost:0",
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128000,
      maxTokens: 4096,
    };

    let callCount = 0;
    const finishFirstStream = createDeferred<void>();
    const finalToolCall = fauxToolCall(
      "shell",
      { command: "echo staged-command" },
      { id: "tool-1" },
    );
    const buildProviderStream = () => {
      callCount += 1;
      const stream = createAssistantMessageEventStream();

      if (callCount === 1) {
        const finalMessage: AssistantMessage = {
          role: "assistant",
          content: [finalToolCall],
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
        const partialStart: AssistantMessage = {
          ...finalMessage,
          content: [fauxToolCall("shell", {}, { id: "tool-1" })],
        };
        const partialDelta: AssistantMessage = {
          ...finalMessage,
          content: [
            fauxToolCall(
              "shell",
              { command: "echo staged-command" },
              { id: "tool-1" },
            ),
          ],
        };

        queueMicrotask(() => {
          stream.push({
            type: "toolcall_start",
            contentIndex: 0,
            partial: partialStart,
          });
          stream.push({
            type: "toolcall_delta",
            contentIndex: 0,
            delta: '{"command":"echo staged-command"}',
            partial: partialDelta,
          });
          stream.push({
            type: "toolcall_end",
            contentIndex: 0,
            toolCall: finalToolCall,
            partial: finalMessage,
          });
          void finishFirstStream.promise.then(() => {
            stream.push({
              type: "done",
              reason: "toolUse",
              message: finalMessage,
            });
            stream.end(finalMessage);
          });
        });

        return stream;
      }

      const finalMessage = fauxAssistantMessage("Done.");
      queueMicrotask(() => {
        stream.push({
          type: "done",
          reason: "stop",
          message: finalMessage,
        });
        stream.end(finalMessage);
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
          logText.includes("[shell ->]") &&
          logText.includes("echo staged-command")
        );
      });

      const logText = collectText({
        type: "vstack",
        props: {},
        children: buildConversationLog(state),
      });

      expect(logText.filter((line) => line === "[shell ->]")).toHaveLength(1);
      expect(
        logText.filter((line) => line === "echo staged-command"),
      ).toHaveLength(1);
      expect(logText).not.toContain("Preparing...");

      finishFirstStream.resolve();
      await waitFor(() => !state.running);
    } finally {
      await stopRunningTurn(state);
      unregisterApiProviders(sourceId);
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
    const finishSecondStream = createDeferred<void>();
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
        void finishSecondStream.promise.then(() => {
          stream.push({
            type: "done",
            reason: "stop",
            message: finalMessage,
          });
          stream.end(finalMessage);
        });
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

      expect(logText.filter((line) => line === "[shell ->]")).toHaveLength(1);
      expect(
        logText.filter((line) => line === "echo tool-output"),
      ).toHaveLength(1);
      expect(logText).toContain("tool-output");
      expect(logText).toContain("Done streaming");
      expect(logText).not.toContain("Exit code: 0");
      expect(logText).not.toContain("Preparing...");
      expect(logText).not.toContain("Running...");

      finishSecondStream.resolve();
      await waitFor(() => !state.running);
    } finally {
      await stopRunningTurn(state);
      process.env.PATH = originalPath;
      unregisterApiProviders(sourceId);
      state.db.close();
    }
  });

  test("blurring the input while idle unfocuses it", () => {
    const state = createTestState();

    try {
      const controller = createInputController(state);

      controller.onBlur();

      const input = expectTextInput(renderInputArea(state.theme, controller));
      expect(input.props.focused).toBe(false);
    } finally {
      state.db.close();
    }
  });

  test("opening input history during a running turn blurs the input without aborting", () => {
    const state = createTestState();
    state.running = true;
    state.abortController = new AbortController();

    try {
      appendPromptHistory(state.db, {
        text: "saved prompt",
        cwd: state.cwd,
      });

      const controller = createInputController(state);
      const base = expectVStack(renderBaseLayout(state, 80, controller));

      base.props.onKeyPress?.("ctrl+r");
      expect(renderActiveOverlay(state)).not.toBeNull();

      controller.onBlur();

      expect(state.abortController.signal.aborted).toBe(false);
      const input = expectTextInput(renderInputArea(state.theme, controller));
      expect(input.props.focused).toBe(false);
      expect(renderActiveOverlay(state)).not.toBeNull();
    } finally {
      state.db.close();
    }
  });

  test("Escape while running blurs the input first and a second Escape aborts", () => {
    const state = createTestState();
    state.running = true;
    state.abortController = new AbortController();

    try {
      const controller = createInputController(state);
      const base = expectVStack(renderBaseLayout(state, 80, controller));

      controller.onBlur();

      const input = expectTextInput(renderInputArea(state.theme, controller));
      expect(input.props.focused).toBe(false);
      expect(state.abortController.signal.aborted).toBe(false);

      base.props.onKeyPress?.("escape");
      expect(state.abortController.signal.aborted).toBe(true);
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

      const input = expectTextInput(renderInputArea(state.theme, controller));
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
      const base = expectVStack(renderBaseLayout(state, 80, controller));

      base.props.onKeyPress?.("ctrl+r");

      const overlay = renderActiveOverlay(state);
      if (!overlay) {
        throw new Error("Expected an active input history overlay");
      }
      const text = collectText(overlay);
      const newestIndex = text.findIndex((line) =>
        line.includes("newest prompt"),
      );
      const olderIndex = text.findIndex((line) =>
        line.includes("older prompt"),
      );

      expect(text).toContain("Input history");
      expect(newestIndex).toBeGreaterThan(-1);
      expect(olderIndex).toBeGreaterThan(-1);
      expect(newestIndex).toBeLessThan(olderIndex);
    } finally {
      state.db.close();
    }
  });

  test("buildConversationLog initially renders only the latest chunk of a long session and reloads older chunks at the top", () => {
    const state = createTestState();
    const controller = createInputController(state);
    state.messages = Array.from({ length: 1_000 }, (_, index) => ({
      role: "user" as const,
      content: `message ${index}`,
      timestamp: index,
    }));

    try {
      const initialIndexes = getVisibleMessageIndexes(state);
      const initialMin = Math.min(...initialIndexes);

      expect(initialIndexes).not.toContain(0);
      expect(Math.max(...initialIndexes)).toBe(999);

      const initialLayout = renderBaseLayout(state, 80, controller);
      findConversationLogNode(initialLayout).props.onScroll?.(0, 10);

      const expandedIndexes = getVisibleMessageIndexes(state);
      expect(Math.min(...expandedIndexes)).toBeLessThan(initialMin);
      expect(expandedIndexes.length).toBeGreaterThan(initialIndexes.length);
      expect(Math.max(...expandedIndexes)).toBe(999);

      const expandedLayout = renderBaseLayout(state, 80, controller);
      findConversationLogNode(expandedLayout).props.onScroll?.(10, 10);

      const collapsedIndexes = getVisibleMessageIndexes(state);
      expect(Math.min(...collapsedIndexes)).toBe(initialMin);
      expect(Math.max(...collapsedIndexes)).toBe(999);
    } finally {
      state.db.close();
    }
  });

  test("renderBaseLayout preserves the viewport anchor when loading an older wrapped chunk at the top", () => {
    const state = createTestState();
    const controller = createInputController(state);
    const width = 20;
    state.messages = Array.from({ length: 120 }, (_, index) => ({
      role: "user" as const,
      content: `message ${index} ${"wrapped ".repeat(8)}`.trim(),
      timestamp: index,
    }));

    try {
      const initialIndexes = getVisibleMessageIndexes(state);
      const initialStart = Math.min(...initialIndexes);

      const initialLayout = renderBaseLayout(state, width, controller);
      findConversationLogNode(initialLayout).props.onScroll?.(0, 10);

      const expandedLayout = renderBaseLayout(state, width, controller);
      const expandedIndexes = getVisibleMessageIndexes(state);
      const nextStart = Math.min(...expandedIndexes);
      const expectedAddedHeight =
        measureConversationHeight(state, width, nextStart) -
        measureConversationHeight(state, width, initialStart);

      expect(nextStart).toBeLessThan(initialStart);
      expect(expectedAddedHeight).toBeGreaterThan(50);
      expect(findConversationLogNode(expandedLayout).props.scrollOffset).toBe(
        expectedAddedHeight,
      );
    } finally {
      state.db.close();
    }
  });

  test("renderBaseLayout keeps autoscroll paused when the user scrolls mid-turn", async () => {
    const api = "ui-mid-turn-scroll-pause-test";
    const sourceId = "ui-mid-turn-scroll-pause-test-source";
    const model: Model<string> = {
      id: "ui-mid-turn-scroll-pause-model",
      name: "UI Mid-turn Scroll Pause Model",
      api,
      provider: "test",
      baseUrl: "http://localhost:0",
      reasoning: true,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128000,
      maxTokens: 4096,
    };

    const releaseSecondDelta = createDeferred<void>();
    const finishStream = createDeferred<void>();
    const finalMessage: AssistantMessage = {
      role: "assistant",
      content: [fauxText("first second")],
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

    const buildProviderStream = () => {
      const stream = createAssistantMessageEventStream();

      queueMicrotask(() => {
        stream.push({
          type: "text_delta",
          contentIndex: 0,
          delta: "first",
          partial: {
            ...finalMessage,
            content: [fauxText("first")],
          },
        });

        void releaseSecondDelta.promise.then(() => {
          stream.push({
            type: "text_delta",
            contentIndex: 0,
            delta: " second",
            partial: finalMessage,
          });

          void finishStream.promise.then(() => {
            stream.push({
              type: "done",
              reason: "stop",
              message: finalMessage,
            });
            stream.end(finalMessage);
          });
        });
      });

      return stream;
    };

    registerApiProvider(
      {
        api,
        stream: () => buildProviderStream(),
        streamSimple: () => buildProviderStream(),
      },
      sourceId,
    );

    const state = createTestState();
    const controller = createInputController(state);
    state.cwd = process.cwd();
    state.canonicalCwd = process.cwd();
    state.model = model;

    try {
      handleInput("hello", state);

      await waitFor(() => {
        const text = collectText({
          type: "vstack",
          props: {},
          children: buildConversationLog(state),
        });
        return state.running && text.includes("first");
      });

      const beforeScroll = renderBaseLayout(state, 80, controller);
      expect(findConversationLogNode(beforeScroll).props.scrollOffset).toBe(
        Infinity,
      );

      findConversationLogNode(beforeScroll).props.onScroll?.(3, 10);

      const pausedLayout = renderBaseLayout(state, 80, controller);
      expect(findConversationLogNode(pausedLayout).props.scrollOffset).toBe(3);

      releaseSecondDelta.resolve();

      await waitFor(() => {
        const text = collectText({
          type: "vstack",
          props: {},
          children: buildConversationLog(state),
        });
        return text.includes("first second");
      });

      const afterSecondDelta = renderBaseLayout(state, 80, controller);
      expect(findConversationLogNode(afterSecondDelta).props.scrollOffset).toBe(
        3,
      );

      finishStream.resolve();
      await waitFor(() => !state.running);
    } finally {
      await stopRunningTurn(state);
      unregisterApiProviders(sourceId);
      state.db.close();
    }
  });

  test("renderBaseLayout shows a single divider line between the conversation and input areas", () => {
    const state = createTestState();
    const controller: InputController = {
      onChange: () => {},
      onFocus: () => {},
      onBlur: () => {},
      onKeyPress: () => undefined,
    };

    try {
      const text = collectText(renderBaseLayout(state, 80, controller));

      expect(text.filter((line) => line === "─")).toHaveLength(1);
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
      const node = expectVStack(
        renderBaseLayout(state, 80, controller, () => {
          suspended = true;
        }),
      );

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
