import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ContainerNode, Node } from "@cel-tui/types";
import { registerFauxProvider } from "@mariozechner/pi-ai";
import type { AppState } from "../index.ts";
import { COMMANDS } from "../input.ts";
import {
  appendPromptHistory,
  computeContextTokens,
  createSession,
  openDatabase,
} from "../session.ts";
import { loadSettings } from "../settings.ts";
import { DEFAULT_THEME } from "../theme.ts";
import {
  createCommandController,
  formatPromptHistoryLabel,
  formatPromptHistoryPreview,
  formatRelativeDate,
  formatSessionLabel,
} from "./commands.ts";
import type { ActiveOverlay } from "./overlay.ts";

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
    queuedUserMessages: [],
    showReasoning: true,
    verbose: false,
    versionLabel: "dev",
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
  test("showCommandAutocomplete clears the current draft and opens the commands overlay", () => {
    const state = createTestState();
    const runtimeState = { overlay: null as ActiveOverlay | null };
    let inputValue = "draft";
    const controller = createCommandController({
      openOverlay: (nextOverlay) => {
        runtimeState.overlay = nextOverlay;
      },
      dismissOverlay: () => {
        runtimeState.overlay = null;
      },
      setInputValue: (value) => {
        inputValue = value;
      },
      appendInfoMessage: () => {},
      scrollConversationToBottom: () => {},
      render: () => {},
      reloadPromptContext: async () => {},
      openInBrowser: () => {},
    });

    try {
      controller.showCommandAutocomplete(state);

      const overlay = expectOverlay(runtimeState.overlay);

      expect(inputValue).toBe("");
      expect(overlay.title).toBe("Commands");

      const text = collectText(overlay.select());
      for (const command of COMMANDS) {
        expect(text.some((line) => line.includes(`/${command}`))).toBe(true);
      }
    } finally {
      state.db.close();
    }
  });

  test("showInputHistoryOverlay restores the selected raw prompt", () => {
    const state = createTestState();
    const runtimeState = { overlay: null as ActiveOverlay | null };
    let inputValue = "draft";
    const rawPrompt = "first line\nsecond line";
    const controller = createCommandController({
      openOverlay: (nextOverlay) => {
        runtimeState.overlay = nextOverlay;
      },
      dismissOverlay: () => {
        runtimeState.overlay = null;
      },
      setInputValue: (value) => {
        inputValue = value;
      },
      appendInfoMessage: () => {},
      scrollConversationToBottom: () => {},
      render: () => {},
      reloadPromptContext: async () => {},
      openInBrowser: () => {},
    });

    try {
      appendPromptHistory(state.db, {
        text: "older prompt",
        cwd: "/tmp/older",
      });
      appendPromptHistory(state.db, { text: rawPrompt, cwd: state.cwd });

      controller.showInputHistoryOverlay(state);

      const overlay = expectOverlay(runtimeState.overlay);

      expect(overlay.title).toBe("Input history");

      const selectNode = renderSelect(overlay);

      selectNode.props.onKeyPress?.("enter");

      expect(runtimeState.overlay).toBeNull();
      expect(inputValue).toBe(rawPrompt);
    } finally {
      state.db.close();
    }
  });

  test("showInputHistoryOverlay dismissal leaves the current draft unchanged", () => {
    const state = createTestState();
    const runtimeState = { overlay: null as ActiveOverlay | null };
    let inputValue = "draft prompt";
    const controller = createCommandController({
      openOverlay: (nextOverlay) => {
        runtimeState.overlay = nextOverlay;
      },
      dismissOverlay: () => {
        runtimeState.overlay = null;
      },
      setInputValue: (value) => {
        inputValue = value;
      },
      appendInfoMessage: () => {},
      scrollConversationToBottom: () => {},
      render: () => {},
      reloadPromptContext: async () => {},
      openInBrowser: () => {},
    });

    try {
      appendPromptHistory(state.db, {
        text: "saved prompt",
        cwd: state.cwd,
      });

      controller.showInputHistoryOverlay(state);

      const overlay = expectOverlay(runtimeState.overlay);
      const selectNode = renderSelect(overlay);

      selectNode.props.onBlur?.();

      expect(runtimeState.overlay).toBeNull();
      expect(inputValue).toBe("draft prompt");
    } finally {
      state.db.close();
    }
  });

  test("handleCommand('session') overlay includes the first user preview for disambiguation", () => {
    const state = createTestState();
    const runtimeState = { overlay: null as ActiveOverlay | null };
    const controller = createCommandController({
      openOverlay: (nextOverlay) => {
        runtimeState.overlay = nextOverlay;
      },
      dismissOverlay: () => {
        runtimeState.overlay = null;
      },
      setInputValue: () => {},
      appendInfoMessage: () => {},
      scrollConversationToBottom: () => {},
      render: () => {},
      reloadPromptContext: async () => {},
      openInBrowser: () => {},
    });
    const session = createSession(state.db, {
      cwd: state.canonicalCwd,
      model: "test/beta",
      effort: "high",
    });

    state.db.run(
      "INSERT INTO messages (session_id, turn, data, created_at) VALUES (?, ?, ?, ?)",
      [
        session.id,
        null,
        JSON.stringify({
          role: "ui",
          kind: "info",
          content: "Help output",
          timestamp: 1,
        }),
        1,
      ],
    );
    state.db.run(
      "INSERT INTO messages (session_id, turn, data, created_at) VALUES (?, ?, ?, ?)",
      [
        session.id,
        1,
        JSON.stringify({
          role: "user",
          content: "Investigate\nthis session label",
          timestamp: 2,
        }),
        2,
      ],
    );

    try {
      expect(controller.handleCommand("session", state)).toBe(true);

      const overlay = expectOverlay(runtimeState.overlay);
      const text = collectText(renderSelect(overlay));

      expect(
        text.some((line) => line.includes("Investigate this session")),
      ).toBe(true);
    } finally {
      state.db.close();
    }
  });

  test("handleCommand('session') restores the selected session and recomputes stats", () => {
    const state = createTestState();
    const runtimeState = { overlay: null as ActiveOverlay | null };
    let scrollCalls = 0;
    const controller = createCommandController({
      openOverlay: (nextOverlay) => {
        runtimeState.overlay = nextOverlay;
      },
      dismissOverlay: () => {
        runtimeState.overlay = null;
      },
      setInputValue: () => {},
      appendInfoMessage: () => {},
      scrollConversationToBottom: () => {
        scrollCalls += 1;
      },
      render: () => {},
      reloadPromptContext: async () => {},
      openInBrowser: () => {},
    });
    const now = new Date("2026-04-07T12:00:00Z").getTime();
    const session = createSession(state.db, {
      cwd: state.canonicalCwd,
      model: "test/beta",
      effort: "high",
    });

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
      expect(overlay.title).toBe("Resume a session");

      const selectNode = renderSelect(overlay);
      selectNode.props.onKeyPress?.("enter");

      expect(runtimeState.overlay).toBeNull();
      expect(scrollCalls).toBe(1);
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
    } finally {
      state.db.close();
    }
  });

  test("handleCommand returns false for unknown commands", () => {
    const state = createTestState();
    const controller = createCommandController({
      openOverlay: () => {},
      dismissOverlay: () => {},
      setInputValue: () => {},
      appendInfoMessage: () => {},
      scrollConversationToBottom: () => {},
      render: () => {},
      reloadPromptContext: async () => {},
      openInBrowser: () => {},
    });

    try {
      expect(controller.handleCommand("unknown", state)).toBe(false);
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
      scrollConversationToBottom: () => {},
      render: () => {},
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
      scrollConversationToBottom: () => {},
      render: () => {},
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
      scrollConversationToBottom: () => {},
      render: () => {},
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

  test("applyModelSelection updates the state and persists the default model", () => {
    const faux = registerFauxProvider();
    const state = createTestState();
    const model = faux.getModel();
    const controller = createCommandController({
      openOverlay: () => {},
      dismissOverlay: () => {},
      setInputValue: () => {},
      appendInfoMessage: () => {},
      scrollConversationToBottom: () => {},
      render: () => {},
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
      scrollConversationToBottom: () => {},
      render: () => {},
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

  test("formatRelativeDate accepts an explicit clock for deterministic output", () => {
    const now = new Date("2026-04-07T12:00:00Z");

    expect(formatRelativeDate(new Date("2026-04-07T11:59:45Z"), now)).toBe(
      "just now",
    );
    expect(formatRelativeDate(new Date("2026-04-07T11:50:00Z"), now)).toBe(
      "10m ago",
    );
    expect(formatRelativeDate(new Date("2026-04-07T10:00:00Z"), now)).toBe(
      "2h ago",
    );
    expect(formatRelativeDate(new Date("2026-04-04T12:00:00Z"), now)).toBe(
      "3d ago",
    );
  });

  test("formatPromptHistoryPreview collapses whitespace into one line", () => {
    expect(formatPromptHistoryPreview("  first\n\n second\tthird  ")).toBe(
      "first second third",
    );
  });

  test("formatPromptHistoryLabel_longPromptAndCwd_returnsATruncatedSingleLineLabel", () => {
    expect(
      formatPromptHistoryLabel(
        "  Investigate\n\n this prompt history row because it is much too wide for the overlay  ",
        "/tmp/projects/very/deeply/nested/mini-coder-audit",
        "5m ago",
      ),
    ).toBe(
      "Investigate this prompt history…  ·  …/mini-coder-audit  ·  5m ago",
    );
  });

  test("formatSessionLabel_longPreviewAndModel_returnsATruncatedReadableLabel", () => {
    expect(
      formatSessionLabel(
        {
          model: "openai-codex/gpt-5.4-super-long-variant",
          firstUserPreview:
            "Audit the session selector because every entry looks identical in real usage",
        },
        "just now",
        true,
      ),
    ).toBe(
      "Audit the session selector…  ·  openai-codex/gpt…  ·  just now  ·  current",
    );
  });
});
