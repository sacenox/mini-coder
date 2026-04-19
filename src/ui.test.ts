import { afterEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cel, MockTerminal } from "@cel-tui/core";
import type { ContainerNode, Node } from "@cel-tui/types";
import type { AssistantMessage, Model } from "@mariozechner/pi-ai";
import {
  createAssistantMessageEventStream,
  fauxAssistantMessage,
  fauxText,
  fauxToolCall,
  registerApiProvider,
  registerFauxProvider,
  unregisterApiProviders,
} from "@mariozechner/pi-ai";
import type { AppState } from "./index.ts";
import { createSession, loadMessages, openDatabase } from "./session.ts";
import { DEFAULT_SHOW_REASONING, DEFAULT_VERBOSE } from "./settings.ts";
import { DEFAULT_THEME } from "./theme.ts";
import {
  createInputController,
  createRenderScheduler,
  handleInput,
  type InputController,
  renderActiveOverlay,
  renderBaseLayout,
  renderInputArea,
  resetUiState,
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
  if (
    node.type === "hstack" &&
    node.children.every((child) => child.type === "text")
  ) {
    return [node.children.map((child) => child.content).join("")];
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

function createDeferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function waitForCelRender(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 10));
}

function startUiViewport(
  state: AppState,
  terminal: MockTerminal,
  controller: InputController,
): void {
  cel.init(terminal);
  cel.viewport(() => {
    const base = renderBaseLayout(state, terminal.columns, controller);
    const overlay = renderActiveOverlay(state);
    return overlay ? [base, overlay] : base;
  });
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
    contextTokens: 0,
    agentsMd: [],
    skills: [],
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
    queuedUserMessages: [],
    showReasoning: DEFAULT_SHOW_REASONING,
    verbose: DEFAULT_VERBOSE,
    versionLabel: "dev",
    customModels: [],
    startupWarnings: [],
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

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe("ui render scheduling", () => {
  test("coalesces repeated stream-priority requests into a single render", async () => {
    let renderCount = 0;
    const scheduler = createRenderScheduler({
      render: () => {
        renderCount += 1;
      },
    });

    scheduler.requestRender("stream");
    scheduler.requestRender("stream");
    scheduler.requestRender("animation");

    expect(renderCount).toBe(0);
    await waitFor(() => renderCount === 1);
    expect(renderCount).toBe(1);
  });

  test("upgrades a pending stream render to normal priority", async () => {
    let renderCount = 0;
    const scheduler = createRenderScheduler({
      render: () => {
        renderCount += 1;
      },
    });

    scheduler.requestRender("stream");
    scheduler.requestRender("normal");

    await Promise.resolve();
    expect(renderCount).toBe(1);
  });
});

describe("ui rendering", () => {
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

  test("queues a mid-run submitted prompt, records its raw input immediately, and replays it on the next model request", async () => {
    const api = "ui-steering-message-test";
    const sourceId = "ui-steering-message-test-source";
    const model: Model<string> = {
      id: "ui-steering-message-model",
      name: "UI Steering Message Model",
      api,
      provider: "test",
      baseUrl: "http://localhost:0",
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128000,
      maxTokens: 4096,
    };

    const releaseFirstResponse = createDeferred<void>();
    let requestCount = 0;
    const buildProviderStream = () => {
      requestCount += 1;
      const stream = createAssistantMessageEventStream();

      if (requestCount === 1) {
        const firstMessage: AssistantMessage = {
          role: "assistant",
          content: [fauxText("First response.")],
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

        queueMicrotask(() => {
          void releaseFirstResponse.promise.then(() => {
            stream.push({
              type: "done",
              reason: "stop",
              message: firstMessage,
            });
            stream.end(firstMessage);
          });
        });

        return stream;
      }

      const secondMessage = fauxAssistantMessage("Handled steering.");
      queueMicrotask(() => {
        stream.push({
          type: "done",
          reason: "stop",
          message: secondMessage,
        });
        stream.end(secondMessage);
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

      handleInput("steer later", state);

      const queuedRows = state.db
        .query<
          { text: string; cwd: string; session_id: string | null },
          []
        >("SELECT text, cwd, session_id FROM prompt_history ORDER BY id DESC LIMIT 2")
        .all();
      expect(queuedRows.map((row) => row.text)).toEqual([
        "steer later",
        "hello",
      ]);
      expect(queuedRows[0]?.cwd).toBe(state.cwd);
      expect(queuedRows[0]?.session_id).toBe(state.session?.id ?? null);
      expect(state.messages.map((message) => message.role)).toEqual(["user"]);

      releaseFirstResponse.resolve();

      await waitFor(() => !state.running);
      expect(state.messages.map((message) => message.role)).toEqual([
        "user",
        "assistant",
        "user",
        "assistant",
      ]);
      expect(state.messages[2]).toMatchObject({
        role: "user",
        content: "steer later",
      });
      expect(requestCount).toBe(2);
    } finally {
      await stopRunningTurn(state);
      unregisterApiProviders(sourceId);
      state.db.close();
    }
  });

  test("keeps a queued steering draft visible and readonly until the queued message is sent", async () => {
    const api = "ui-steering-input-readonly-test";
    const sourceId = "ui-steering-input-readonly-test-source";
    const model: Model<string> = {
      id: "ui-steering-input-readonly-model",
      name: "UI Steering Input Readonly Model",
      api,
      provider: "test",
      baseUrl: "http://localhost:0",
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128000,
      maxTokens: 4096,
    };

    const releaseFirstResponse = createDeferred<void>();
    const releaseSecondResponse = createDeferred<void>();
    let requestCount = 0;
    const buildProviderStream = () => {
      requestCount += 1;
      const stream = createAssistantMessageEventStream();

      if (requestCount === 1) {
        const firstMessage: AssistantMessage = {
          role: "assistant",
          content: [fauxText("First response.")],
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

        queueMicrotask(() => {
          void releaseFirstResponse.promise.then(() => {
            stream.push({
              type: "done",
              reason: "stop",
              message: firstMessage,
            });
            stream.end(firstMessage);
          });
        });

        return stream;
      }

      const secondMessage = fauxAssistantMessage("Handled steering.");
      queueMicrotask(() => {
        void releaseSecondResponse.promise.then(() => {
          stream.push({
            type: "done",
            reason: "stop",
            message: secondMessage,
          });
          stream.end(secondMessage);
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
      const controller = createInputController(state);

      controller.onChange("hello");
      expect(controller.onKeyPress("enter")).toBe(false);
      expect(
        expectTextInput(renderInputArea(state.theme, controller)).props.value,
      ).toBe("");
      await waitFor(() => state.running && state.session !== null);

      controller.onChange("steer later");
      expect(controller.onKeyPress("enter")).toBe(false);
      expect(
        expectTextInput(renderInputArea(state.theme, controller)).props.value,
      ).toBe("steer later");
      expect(state.queuedUserMessages).toHaveLength(1);

      controller.onChange("should stay blocked");
      expect(
        expectTextInput(renderInputArea(state.theme, controller)).props.value,
      ).toBe("steer later");
      expect(controller.onKeyPress("enter")).toBe(false);
      expect(state.queuedUserMessages).toHaveLength(1);

      releaseFirstResponse.resolve();

      await waitFor(
        () =>
          requestCount === 2 &&
          state.running &&
          state.messages.some(
            (message) =>
              message.role === "user" && message.content === "steer later",
          ),
      );

      expect(
        expectTextInput(renderInputArea(state.theme, controller)).props.value,
      ).toBe("");
      expect(state.queuedUserMessages).toHaveLength(0);

      controller.onChange("ready again");
      expect(
        expectTextInput(renderInputArea(state.theme, controller)).props.value,
      ).toBe("ready again");

      releaseSecondResponse.resolve();
      await waitFor(() => !state.running);
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

  test("aborted queued steering is discarded without leaking into the replacement run or prompt history", async () => {
    const api = "ui-queued-steering-abort-reset-test";
    const sourceId = "ui-queued-steering-abort-reset-test-source";
    const model: Model<string> = {
      id: "ui-queued-steering-abort-reset-model",
      name: "UI Queued Steering Abort Reset Model",
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

    let requestCount = 0;
    const buildProviderStream = (signal?: AbortSignal) => {
      requestCount += 1;
      const stream = createAssistantMessageEventStream();

      if (requestCount === 1) {
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
            emitAbort();
            return;
          }

          signal?.addEventListener("abort", emitAbort, { once: true });
        });

        return stream;
      }

      const replacementMessage = fauxAssistantMessage("Replacement response.");
      queueMicrotask(() => {
        stream.push({
          type: "done",
          reason: "stop",
          message: replacementMessage,
        });
        stream.end(replacementMessage);
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
      const controller = createInputController(state);

      controller.onChange("hello");
      expect(controller.onKeyPress("enter")).toBe(false);
      await waitFor(
        () =>
          state.running &&
          state.session !== null &&
          state.abortController !== null,
      );

      const sessionId = state.session?.id;
      if (!sessionId) {
        throw new Error("Expected a session to be created");
      }

      controller.onChange("steer later");
      expect(controller.onKeyPress("enter")).toBe(false);
      expect(
        expectTextInput(renderInputArea(state.theme, controller)).props.value,
      ).toBe("steer later");
      expect(state.queuedUserMessages).toHaveLength(1);

      state.abortController?.abort();
      await waitFor(() => !state.running);

      const input = expectTextInput(renderInputArea(state.theme, controller));
      expect(input.props.value).toBe("");
      expect(input.props.focused).toBe(true);
      expect(state.queuedUserMessages).toEqual([]);

      const messagesAfterAbort = loadMessages(state.db, sessionId);
      const userContentsAfterAbort = messagesAfterAbort
        .filter((message) => message.role === "user")
        .map((message) => {
          if (typeof message.content !== "string") {
            throw new Error("Expected only text user messages");
          }
          return message.content;
        });
      expect(userContentsAfterAbort).toEqual(["hello"]);

      const historyAfterAbort = state.db
        .query<
          { text: string },
          []
        >("SELECT text FROM prompt_history ORDER BY id DESC LIMIT 2")
        .all();
      expect(historyAfterAbort.map((entry) => entry.text)).toEqual([
        "steer later",
        "hello",
      ]);

      controller.onChange("replacement prompt");
      expect(controller.onKeyPress("enter")).toBe(false);
      await waitFor(
        () =>
          !state.running &&
          state.messages.filter((message) => message.role === "user").length ===
            2,
      );

      const finalMessages = loadMessages(state.db, sessionId);
      const finalUserContents = finalMessages
        .filter((message) => message.role === "user")
        .map((message) => {
          if (typeof message.content !== "string") {
            throw new Error("Expected only text user messages");
          }
          return message.content;
        });
      expect(finalUserContents).toEqual(["hello", "replacement prompt"]);
      expect(finalUserContents).not.toContain("steer later");
      expect(requestCount).toBe(2);

      const finalHistory = state.db
        .query<
          { text: string },
          []
        >("SELECT text FROM prompt_history ORDER BY id DESC LIMIT 3")
        .all();
      expect(finalHistory.map((entry) => entry.text)).toEqual([
        "replacement prompt",
        "steer later",
        "hello",
      ]);
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

      expect(userMessage.content).toContain("# Review Checklist");
      expect(userMessage.content).toContain("- Find bugs");
      expect(userMessage.content).toContain("- Note missing tests");
      expect(userMessage.content).toEndWith("check the auth module");
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

  test("Escape aborts a running shell tool even when the shell command spawned a child process", async () => {
    const state = createTestState();
    const faux = registerFauxProvider();
    const cwd = createTempDir();
    const terminal = new MockTerminal(80, 20);
    const pidFile = join(cwd, "child.pid");
    let childPid: number | null = null;
    state.model = faux.getModel();
    state.cwd = cwd;
    state.canonicalCwd = cwd;
    faux.setResponses([
      fauxAssistantMessage(
        [
          fauxToolCall("shell", {
            command: `sleep 30 & echo $! > '${pidFile}' && wait`,
          }),
        ],
        {
          stopReason: "toolUse",
        },
      ),
    ]);

    try {
      const controller = createInputController(state);
      startUiViewport(state, terminal, controller);
      await waitForCelRender();

      handleInput("interrupt the spawned tool", state);

      await waitFor(
        () =>
          state.running &&
          state.activeTurnPromise !== null &&
          existsSync(pidFile),
      );
      childPid = Number(readFileSync(pidFile, "utf-8").trim());

      terminal.sendInput("\x1b");
      await waitFor(() => !state.running, 1_000);

      const activeTurnPromise = state.activeTurnPromise;
      if (activeTurnPromise) {
        await activeTurnPromise;
      }

      expect(state.messages.map((message) => message.role)).toEqual([
        "user",
        "assistant",
        "toolResult",
      ]);
      await waitFor(
        () => childPid !== null && !isProcessAlive(childPid),
        1_000,
      );
    } finally {
      if (childPid !== null && isProcessAlive(childPid)) {
        process.kill(childPid, "SIGKILL");
      }
      await stopRunningTurn(state);
      cel.stop();
      faux.unregister();
      state.db.close();
    }
  });

  test("Escape dismisses the path picker without changing the current draft", async () => {
    const state = createTestState();
    const cwd = createTempDir();
    const terminal = new MockTerminal(80, 20);
    mkdirSync(join(cwd, "src"), { recursive: true });
    writeFileSync(join(cwd, "src", "ui.ts"), "", "utf-8");
    writeFileSync(join(cwd, "src", "utils.ts"), "", "utf-8");
    state.cwd = cwd;
    state.canonicalCwd = cwd;

    try {
      const controller = createInputController(state);
      controller.onChange("inspect src/u");
      expect(controller.onKeyPress("tab")).toBe(false);

      const overlayText = collectText(renderActiveOverlay(state));
      expect(overlayText.some((line) => line.includes("src/ui.ts"))).toBe(true);
      expect(overlayText.some((line) => line.includes("src/utils.ts"))).toBe(
        true,
      );

      startUiViewport(state, terminal, controller);
      await waitForCelRender();

      terminal.sendInput("\x1b");
      await waitFor(() => renderActiveOverlay(state) === null);

      const input = expectTextInput(renderInputArea(state.theme, controller));
      expect(input.props.value).toBe("inspect src/u");
      expect(input.props.focused).toBe(true);
    } finally {
      cel.stop();
      state.db.close();
    }
  });

  test("Escape dismisses command overlays without aborting the run or clearing a readonly steering draft", async () => {
    const api = "ui-overlay-escape-running-test";
    const sourceId = "ui-overlay-escape-running-test-source";
    const model: Model<string> = {
      id: "ui-overlay-escape-running-model",
      name: "UI Overlay Escape Running Model",
      api,
      provider: "test",
      baseUrl: "http://localhost:0",
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128000,
      maxTokens: 4096,
    };

    const releaseFirstResponse = createDeferred<void>();
    let requestCount = 0;
    const buildProviderStream = () => {
      requestCount += 1;
      const stream = createAssistantMessageEventStream();

      if (requestCount === 1) {
        const firstMessage: AssistantMessage = {
          role: "assistant",
          content: [fauxText("First response.")],
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

        queueMicrotask(() => {
          void releaseFirstResponse.promise.then(() => {
            stream.push({
              type: "done",
              reason: "stop",
              message: firstMessage,
            });
            stream.end(firstMessage);
          });
        });

        return stream;
      }

      const secondMessage = fauxAssistantMessage("Handled steering.");
      queueMicrotask(() => {
        stream.push({
          type: "done",
          reason: "stop",
          message: secondMessage,
        });
        stream.end(secondMessage);
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
    const terminal = new MockTerminal(80, 20);
    state.cwd = process.cwd();
    state.canonicalCwd = process.cwd();
    state.model = model;

    try {
      const controller = createInputController(state);
      startUiViewport(state, terminal, controller);
      await waitForCelRender();

      controller.onChange("hello");
      expect(controller.onKeyPress("enter")).toBe(false);
      await waitFor(
        () =>
          state.running &&
          state.session !== null &&
          state.abortController !== null,
      );

      controller.onChange("steer later");
      expect(controller.onKeyPress("enter")).toBe(false);
      expect(
        expectTextInput(renderInputArea(state.theme, controller)).props.value,
      ).toBe("steer later");
      expect(state.queuedUserMessages).toHaveLength(1);

      const base = expectVStack(renderBaseLayout(state, 80, controller));
      expect(base.props.onKeyPress?.("ctrl+r")).toBeUndefined();
      expect(renderActiveOverlay(state)).not.toBeNull();
      await waitForCelRender();

      terminal.sendInput("\x1b");
      await waitFor(() => renderActiveOverlay(state) === null);

      const input = expectTextInput(renderInputArea(state.theme, controller));
      expect(input.props.value).toBe("steer later");
      expect(input.props.focused).toBe(true);
      expect(state.running).toBe(true);
      expect(state.abortController?.signal.aborted).toBe(false);
      expect(state.queuedUserMessages).toHaveLength(1);

      releaseFirstResponse.resolve();
      await waitFor(() => !state.running);
      expect(requestCount).toBe(2);
    } finally {
      await stopRunningTurn(state);
      cel.stop();
      unregisterApiProviders(sourceId);
      state.db.close();
    }
  });

  test("Tab opens a path picker when multiple file path matches are available", () => {
    const state = createTestState();
    const cwd = createTempDir();
    mkdirSync(join(cwd, "src"), { recursive: true });
    writeFileSync(join(cwd, "src", "ui.ts"), "", "utf-8");
    writeFileSync(join(cwd, "src", "utils.ts"), "", "utf-8");
    state.cwd = cwd;
    state.canonicalCwd = cwd;

    try {
      const controller = createInputController(state);
      controller.onChange("inspect src/u");

      expect(controller.onKeyPress("tab")).toBe(false);

      const overlay = renderActiveOverlay(state);
      if (!overlay || overlay.type !== "vstack") {
        throw new Error("Expected an active path picker overlay");
      }
      const overlayText = collectText(overlay);
      expect(overlayText.some((line) => line.includes("src/ui.ts"))).toBe(true);
      expect(overlayText.some((line) => line.includes("src/utils.ts"))).toBe(
        true,
      );
      expect(
        expectTextInput(renderInputArea(state.theme, controller)).props.value,
      ).toBe("inspect src/u");
      expect(
        expectTextInput(renderInputArea(state.theme, controller)).props.focused,
      ).toBe(false);

      const modal = expectVStack(overlay.children[0]!);
      const selectNode = expectVStack(modal.children[1]!);
      selectNode.props.onKeyPress?.("down");
      selectNode.props.onKeyPress?.("enter");

      const input = expectTextInput(renderInputArea(state.theme, controller));
      expect(input.props.value).toBe("inspect src/utils.ts");
      expect(input.props.focused).toBe(true);
      expect(renderActiveOverlay(state)).toBeNull();
    } finally {
      state.db.close();
    }
  });
});
