import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ContainerNode } from "@cel-tui/types";
import { registerFauxProvider, Type } from "@mariozechner/pi-ai";
import { type AppState, buildToolList } from "../index.ts";
import {
  computeContextTokens,
  createSession,
  loadMessages,
  openDatabase,
} from "../session.ts";
import { loadSettings, saveSettings } from "../settings.ts";
import { DEFAULT_THEME } from "../theme.ts";
import { createCommandController } from "./commands.ts";
import type { ActiveOverlay } from "./overlay.ts";

function expectOverlay(overlay: ActiveOverlay | null): ActiveOverlay {
  if (!overlay) {
    throw new Error("Expected an active overlay");
  }
  return overlay;
}

function renderSelect(overlay: ActiveOverlay): ContainerNode {
  return overlay.select();
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
  const dir = mkdtempSync(join(tmpdir(), "mini-coder-ui-commands-test-"));
  tempDirs.push(dir);
  return dir;
}

function createTestState(): AppState {
  const db = openDatabase(":memory:");
  const cwd = "/tmp/mini-coder-ui-commands-test";
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
    repoSettings: {},
    settingsPath,
    cwd,
    canonicalCwd: cwd,
    running: false,
    abortController: null,
    activeTurnPromise: null,
    queuedUserMessages: [],
    showReasoning: true,
    verbose: false,
    versionLabel: "dev",
    mcpServers: [],
    customModels: [],
    startupWarnings: [],
  };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("ui/commands", () => {
  test("handleCommand('session') restores the selected session and recomputes stats", () => {
    const state = createTestState();
    const runtimeState = { overlay: null as ActiveOverlay | null };
    let scrollCalls = 0;
    let renderCalls = 0;
    const controller = createCommandController({
      openOverlay: (nextOverlay) => {
        runtimeState.overlay = nextOverlay;
      },
      dismissOverlay: () => {
        runtimeState.overlay = null;
      },
      setInputValue: () => {},
      appendInfoMessage: () => {},
      appendTodoMessage: () => {},
      scrollConversationToBottom: () => {
        scrollCalls += 1;
      },
      requestRender: () => {
        renderCalls += 1;
      },
      reloadPromptContext: async () => {},
      openInBrowser: () => {},
    });
    const now = new Date("2026-04-07T12:00:00Z").getTime();
    const session = createSession(state.db, {
      cwd: state.canonicalCwd,
      model: "test/beta",
      effort: "high",
    });
    state.queuedUserMessages = [
      { role: "user", content: "stale steering", timestamp: now - 1 },
    ];

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

    try {
      expect(controller.handleCommand("session", state)).toBe(true);

      const overlay = expectOverlay(runtimeState.overlay);
      const selectNode = renderSelect(overlay);
      selectNode.props.onKeyPress?.("enter");

      expect(runtimeState.overlay).toBeNull();
      expect(scrollCalls).toBe(1);
      expect(renderCalls).toBe(1);
      expect(state.session?.id).toBe(session.id);
      expect(state.messages.map((message) => message.role)).toEqual([
        "user",
        "assistant",
      ]);
      expect(state.stats).toEqual({
        totalInput: 0,
        totalOutput: 0,
        totalCost: 0,
      });
      expect(state.contextTokens).toBe(computeContextTokens(state.messages));
      expect(state.queuedUserMessages).toEqual([]);
    } finally {
      state.db.close();
    }
  });

  test("/new clears the active session state and reloads prompt context", async () => {
    const state = createTestState();
    let reloadCount = 0;
    const reloadFinished = createDeferred<void>();
    const controller = createCommandController({
      openOverlay: () => {},
      dismissOverlay: () => {},
      setInputValue: () => {},
      appendInfoMessage: () => {},
      appendTodoMessage: () => {},
      scrollConversationToBottom: () => {},
      requestRender: () => {},
      reloadPromptContext: async (nextState) => {
        reloadCount++;
        nextState.agentsMd = [
          { path: "/tmp/reloaded/AGENTS.md", content: "Reloaded context" },
        ];
        reloadFinished.resolve();
      },
      openInBrowser: () => {},
    });

    state.session = {
      id: "session-1",
      cwd: state.canonicalCwd,
      model: null,
      effort: state.effort,
      forkedFrom: null,
      createdAt: 1,
      updatedAt: 1,
    };
    state.messages = [
      { role: "ui", kind: "info", content: "old", timestamp: 1 },
    ];
    state.stats = { totalInput: 10, totalOutput: 20, totalCost: 0.5 };
    state.contextTokens = 123;
    state.queuedUserMessages = [
      { role: "user", content: "stale steering", timestamp: 2 },
    ];

    try {
      expect(controller.handleCommand("new", state)).toBe(true);
      await reloadFinished.promise;

      expect(reloadCount).toBe(1);
      expect(state.session).toBeNull();
      expect(state.messages).toEqual([]);
      expect(state.stats).toEqual({
        totalInput: 0,
        totalOutput: 0,
        totalCost: 0,
      });
      expect(state.contextTokens).toBe(0);
      expect(state.agentsMd).toEqual([
        { path: "/tmp/reloaded/AGENTS.md", content: "Reloaded context" },
      ]);
      expect(state.queuedUserMessages).toEqual([]);
    } finally {
      state.db.close();
    }
  });

  test("/undo clears queued steering before removing the latest turn", async () => {
    const state = createTestState();
    const controller = createCommandController({
      openOverlay: () => {},
      dismissOverlay: () => {},
      setInputValue: () => {},
      appendInfoMessage: () => {},
      appendTodoMessage: () => {},
      scrollConversationToBottom: () => {},
      requestRender: () => {},
      reloadPromptContext: async () => {},
      openInBrowser: () => {},
    });
    const now = new Date("2026-04-07T12:00:00Z").getTime();
    const session = createSession(state.db, {
      cwd: state.canonicalCwd,
      model: "test/beta",
      effort: "high",
    });

    state.session = session;
    state.queuedUserMessages = [
      { role: "user", content: "stale steering", timestamp: now + 2 },
    ];
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
    state.messages = loadMessages(state.db, session.id);

    try {
      expect(controller.handleCommand("undo", state)).toBe(true);
      await Promise.resolve();

      expect(state.queuedUserMessages).toEqual([]);
      expect(state.messages).toEqual([]);
    } finally {
      state.db.close();
    }
  });

  test("/reasoning toggles the UI state and persists it", () => {
    const state = createTestState();
    const controller = createCommandController({
      openOverlay: () => {},
      dismissOverlay: () => {},
      setInputValue: () => {},
      appendInfoMessage: () => {},
      appendTodoMessage: () => {},
      scrollConversationToBottom: () => {},
      requestRender: () => {},
      reloadPromptContext: async () => {},
      openInBrowser: () => {},
    });

    try {
      expect(controller.handleCommand("reasoning", state)).toBe(true);
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
    const controller = createCommandController({
      openOverlay: () => {},
      dismissOverlay: () => {},
      setInputValue: () => {},
      appendInfoMessage: () => {},
      appendTodoMessage: () => {},
      scrollConversationToBottom: () => {},
      requestRender: () => {},
      reloadPromptContext: async () => {},
      openInBrowser: () => {},
    });

    try {
      expect(controller.handleCommand("verbose", state)).toBe(true);
      expect(state.verbose).toBe(true);
      expect(state.settings.verbose).toBe(true);
      expect(loadSettings(state.settingsPath)).toEqual({ verbose: true });
    } finally {
      state.db.close();
    }
  });

  test("/mcp toggles the selected server, persists it, and reconnects when re-enabled", async () => {
    const state = createTestState();
    state.model = {
      id: "test-model",
      name: "test-model",
      api: "openai-completions",
      provider: "test-provider",
      baseUrl: "http://localhost:1234/v1",
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 8192,
      maxTokens: 4096,
    };

    const docsTools = [
      {
        name: "docs__search",
        description: "[MCP docs] Search the docs",
        parameters: Type.Object({}),
      },
      {
        name: "docs__fetch",
        description: "[MCP docs] Fetch a page",
        parameters: Type.Object({}),
      },
    ];
    const docsHandlers = new Map();
    let disconnectCalls = 0;
    let connectCalls = 0;

    state.mcpServers = [
      {
        name: "docs",
        url: "http://docs.test/mcp",
        enabled: true,
        connected: true,
        tools: docsTools,
        toolHandlers: docsHandlers,
        close: async () => {
          disconnectCalls += 1;
        },
      },
    ];
    state.settings = saveSettings(state.settingsPath, {
      mcp: {
        servers: [
          {
            name: "docs",
            url: "http://docs.test/mcp",
            enabled: true,
          },
          {
            name: "down",
            url: "http://down.test/mcp",
            enabled: false,
          },
        ],
      },
    });
    const runtimeState = { overlay: null as ActiveOverlay | null };
    const appended: Array<{
      text: string;
      sessionId: string | null;
    }> = [];
    const controller = createCommandController(
      {
        openOverlay: (nextOverlay) => {
          runtimeState.overlay = nextOverlay;
        },
        dismissOverlay: () => {
          runtimeState.overlay = null;
        },
        setInputValue: () => {},
        appendInfoMessage: (text, nextState) => {
          appended.push({ text, sessionId: nextState.session?.id ?? null });
        },
        appendTodoMessage: () => {},
        scrollConversationToBottom: () => {},
        requestRender: () => {},
        reloadPromptContext: async () => {},
        openInBrowser: () => {},
      },
      {
        connectMcpServer: async (server) => {
          connectCalls += 1;
          server.connected = true;
          server.tools = docsTools;
          server.toolHandlers = docsHandlers;
          server.close = async () => {
            disconnectCalls += 1;
          };
          return [];
        },
        disconnectMcpServer: async (server) => {
          await server.close();
          server.connected = false;
          server.tools = [];
          server.toolHandlers = new Map();
          server.close = async () => {};
        },
      },
    );

    try {
      expect(controller.handleCommand("mcp", state)).toBe(true);
      const firstOverlay = expectOverlay(runtimeState.overlay);
      expect(firstOverlay.title).toBe("Toggle MCP servers");
      expect(buildToolList(state).tools.map((tool) => tool.name)).toContain(
        "docs__search",
      );
      renderSelect(firstOverlay).props.onKeyPress?.("enter");
      await Promise.resolve();
      await Promise.resolve();

      expect(runtimeState.overlay).toBeNull();
      expect(state.mcpServers[0]?.enabled).toBe(false);
      expect(state.mcpServers[0]?.connected).toBe(false);
      expect(state.settings.mcp).toEqual({
        servers: [
          {
            name: "docs",
            url: "http://docs.test/mcp",
            enabled: false,
          },
          {
            name: "down",
            url: "http://down.test/mcp",
            enabled: false,
          },
        ],
      });
      expect(loadSettings(state.settingsPath)).toEqual({
        mcp: {
          servers: [
            {
              name: "docs",
              url: "http://docs.test/mcp",
              enabled: false,
            },
            {
              name: "down",
              url: "http://down.test/mcp",
              enabled: false,
            },
          ],
        },
      });
      expect(disconnectCalls).toBe(1);
      expect(appended).toEqual([
        {
          text: 'Disabled MCP server "docs" (-2 tools).',
          sessionId: null,
        },
      ]);
      expect(buildToolList(state).tools.map((tool) => tool.name)).not.toContain(
        "docs__search",
      );

      expect(controller.handleCommand("mcp", state)).toBe(true);
      const secondOverlay = expectOverlay(runtimeState.overlay);
      renderSelect(secondOverlay).props.onKeyPress?.("enter");
      await Promise.resolve();
      await Promise.resolve();

      expect(state.mcpServers[0]?.enabled).toBe(true);
      expect(state.mcpServers[0]?.connected).toBe(true);
      expect(connectCalls).toBe(1);
      expect(loadSettings(state.settingsPath)).toEqual({
        mcp: {
          servers: [
            {
              name: "docs",
              url: "http://docs.test/mcp",
              enabled: true,
            },
            {
              name: "down",
              url: "http://down.test/mcp",
              enabled: false,
            },
          ],
        },
      });
      expect(appended[1]).toEqual({
        text: 'Enabled MCP server "docs" (+2 tools).',
        sessionId: null,
      });
      expect(buildToolList(state).tools.map((tool) => tool.name)).toContain(
        "docs__search",
      );
    } finally {
      state.db.close();
    }
  });

  test("/mcp toggles repo-local servers for the current run without persisting a global shadow copy", async () => {
    const state = createTestState();
    state.model = {
      id: "test-model",
      name: "test-model",
      api: "openai-completions",
      provider: "test-provider",
      baseUrl: "http://localhost:1234/v1",
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 8192,
      maxTokens: 4096,
    };

    const docsTools = [
      {
        name: "docs__search",
        description: "[MCP docs] Search the docs",
        parameters: Type.Object({}),
      },
    ];
    const docsHandlers = new Map();
    let disconnectCalls = 0;
    let connectCalls = 0;

    state.mcpServers = [
      {
        name: "docs",
        url: "http://repo-docs.test/mcp",
        enabled: true,
        connected: true,
        tools: docsTools,
        toolHandlers: docsHandlers,
        close: async () => {
          disconnectCalls += 1;
        },
      },
    ];
    state.settings = saveSettings(state.settingsPath, {
      mcp: {
        servers: [
          {
            name: "docs",
            url: "http://global-docs.test/mcp",
            enabled: false,
          },
          {
            name: "down",
            url: "http://down.test/mcp",
            enabled: false,
          },
        ],
      },
    });
    state.repoSettings = {
      mcp: {
        servers: [
          {
            name: "docs",
            url: "http://repo-docs.test/mcp",
            enabled: true,
          },
        ],
      },
    };
    const runtimeState = { overlay: null as ActiveOverlay | null };
    const appended: Array<{
      text: string;
      sessionId: string | null;
    }> = [];
    const controller = createCommandController(
      {
        openOverlay: (nextOverlay) => {
          runtimeState.overlay = nextOverlay;
        },
        dismissOverlay: () => {
          runtimeState.overlay = null;
        },
        setInputValue: () => {},
        appendInfoMessage: (text, nextState) => {
          appended.push({ text, sessionId: nextState.session?.id ?? null });
        },
        appendTodoMessage: () => {},
        scrollConversationToBottom: () => {},
        requestRender: () => {},
        reloadPromptContext: async () => {},
        openInBrowser: () => {},
      },
      {
        connectMcpServer: async (server) => {
          connectCalls += 1;
          server.connected = true;
          server.tools = docsTools;
          server.toolHandlers = docsHandlers;
          server.close = async () => {
            disconnectCalls += 1;
          };
          return [];
        },
        disconnectMcpServer: async (server) => {
          await server.close();
          server.connected = false;
          server.tools = [];
          server.toolHandlers = new Map();
          server.close = async () => {};
        },
      },
    );

    try {
      expect(controller.handleCommand("mcp", state)).toBe(true);
      renderSelect(expectOverlay(runtimeState.overlay)).props.onKeyPress?.(
        "enter",
      );
      await Promise.resolve();
      await Promise.resolve();

      expect(state.mcpServers[0]?.enabled).toBe(false);
      expect(state.mcpServers[0]?.connected).toBe(false);
      expect(state.settings).toEqual({
        mcp: {
          servers: [
            {
              name: "docs",
              url: "http://global-docs.test/mcp",
              enabled: false,
            },
            {
              name: "down",
              url: "http://down.test/mcp",
              enabled: false,
            },
          ],
        },
      });
      expect(loadSettings(state.settingsPath)).toEqual(state.settings);
      expect(disconnectCalls).toBe(1);

      expect(controller.handleCommand("mcp", state)).toBe(true);
      renderSelect(expectOverlay(runtimeState.overlay)).props.onKeyPress?.(
        "enter",
      );
      await Promise.resolve();
      await Promise.resolve();

      expect(state.mcpServers[0]?.enabled).toBe(true);
      expect(state.mcpServers[0]?.connected).toBe(true);
      expect(connectCalls).toBe(1);
      expect(state.settings).toEqual({
        mcp: {
          servers: [
            {
              name: "docs",
              url: "http://global-docs.test/mcp",
              enabled: false,
            },
            {
              name: "down",
              url: "http://down.test/mcp",
              enabled: false,
            },
          ],
        },
      });
      expect(loadSettings(state.settingsPath)).toEqual(state.settings);
      expect(appended).toEqual([
        {
          text: 'Disabled MCP server "docs" (-1 tool).',
          sessionId: null,
        },
        {
          text: 'Enabled MCP server "docs" (+1 tool).',
          sessionId: null,
        },
      ]);
    } finally {
      state.db.close();
    }
  });

  test("/help appends a markdown info message without creating a session", () => {
    const state = createTestState();
    state.mcpServers = [
      {
        name: "docs",
        url: "http://docs.test/mcp",
        enabled: false,
        connected: false,
        tools: [],
        toolHandlers: new Map(),
        close: async () => {},
      },
    ];
    const appended: Array<{
      text: string;
      format: string | undefined;
      sessionId: string | null;
    }> = [];
    const controller = createCommandController({
      openOverlay: () => {},
      dismissOverlay: () => {},
      setInputValue: () => {},
      appendInfoMessage: (text, nextState, format) => {
        appended.push({
          text,
          format,
          sessionId: nextState.session?.id ?? null,
        });
      },
      appendTodoMessage: () => {},
      scrollConversationToBottom: () => {},
      requestRender: () => {},
      reloadPromptContext: async () => {},
      openInBrowser: () => {},
    });

    try {
      expect(controller.handleCommand("help", state)).toBe(true);
      expect(appended).toHaveLength(1);
      expect(appended[0]?.text.length).toBeGreaterThan(0);
      expect(appended[0]?.text).toContain("`/mcp`");
      expect(appended[0]?.text).toContain("`/skill:name`");
      expect(appended[0]?.text).toContain(
        "submit `/skill` to open the skill picker",
      );
      expect(appended[0]?.text).toContain("`docs` (off)");
      expect(appended[0]?.format).toBe("markdown");
      expect(appended[0]?.sessionId).toBeNull();
      expect(state.session).toBeNull();
    } finally {
      state.db.close();
    }
  });

  test("/todo appends the current todo list without creating a session", () => {
    const state = createTestState();
    state.messages = [
      {
        role: "toolResult",
        toolCallId: "todo-1",
        toolName: "todoWrite",
        content: [
          {
            type: "text",
            text: JSON.stringify({
              todos: [
                { content: "Review prompt wording", status: "completed" },
                { content: "Implement todo tools", status: "in_progress" },
              ],
            }),
          },
        ],
        isError: false,
        timestamp: 1,
      },
    ];
    const appended: Array<{
      todos: Array<{ content: string; status: string }>;
      sessionId: string | null;
    }> = [];
    const controller = createCommandController({
      openOverlay: () => {},
      dismissOverlay: () => {},
      setInputValue: () => {},
      appendInfoMessage: () => {},
      appendTodoMessage: (todos, nextState) => {
        appended.push({
          todos: todos.map((todo) => ({ ...todo })),
          sessionId: nextState.session?.id ?? null,
        });
      },
      scrollConversationToBottom: () => {},
      requestRender: () => {},
      reloadPromptContext: async () => {},
      openInBrowser: () => {},
    });

    try {
      expect(controller.handleCommand("todo", state)).toBe(true);
      expect(appended).toEqual([
        {
          todos: [
            { content: "Review prompt wording", status: "completed" },
            { content: "Implement todo tools", status: "in_progress" },
          ],
          sessionId: null,
        },
      ]);
      expect(state.session).toBeNull();
    } finally {
      state.db.close();
    }
  });

  test("applyModelSelection updates the state and persists the default model", () => {
    const faux = registerFauxProvider();
    const state = createTestState();
    const model = faux.getModel();
    const controller = createCommandController({
      openOverlay: () => {},
      dismissOverlay: () => {},
      setInputValue: () => {},
      appendInfoMessage: () => {},
      appendTodoMessage: () => {},
      scrollConversationToBottom: () => {},
      requestRender: () => {},
      reloadPromptContext: async () => {},
      openInBrowser: () => {},
    });

    try {
      controller.applyModelSelection(state, model);

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

  test("applyEffortSelection updates the active effort and persists the default effort", () => {
    const state = createTestState();
    const controller = createCommandController({
      openOverlay: () => {},
      dismissOverlay: () => {},
      setInputValue: () => {},
      appendInfoMessage: () => {},
      appendTodoMessage: () => {},
      scrollConversationToBottom: () => {},
      requestRender: () => {},
      reloadPromptContext: async () => {},
      openInBrowser: () => {},
    });

    try {
      controller.applyEffortSelection(state, "xhigh");

      expect(state.effort).toBe("xhigh");
      expect(state.settings.defaultEffort).toBe("xhigh");
      expect(loadSettings(state.settingsPath)).toEqual({
        defaultEffort: "xhigh",
      });
    } finally {
      state.db.close();
    }
  });
});
