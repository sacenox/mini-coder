import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ContainerNode, Node } from "@cel-tui/types";
import { registerFauxProvider } from "@mariozechner/pi-ai";
import type { AppState } from "../index.ts";
import { COMMANDS } from "../input.ts";
import { appendPromptHistory, openDatabase } from "../session.ts";
import { loadSettings } from "../settings.ts";
import { DEFAULT_THEME } from "../theme.ts";
import * as commandsModule from "./commands.ts";
import {
  createCommandController,
  formatPromptHistoryPreview,
  formatRelativeDate,
} from "./commands.ts";
import type { ActiveOverlay } from "./overlay.ts";
import { renderOverlay } from "./overlay.ts";

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
    showReasoning: true,
    verbose: false,
  };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("ui/commands", () => {
  test("commands.ts keeps selection helpers private", () => {
    const exports = Object.keys(commandsModule);

    expect(exports).not.toContain("applyEffortSelection");
    expect(exports).not.toContain("applyModelSelection");
  });

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

      const overlay = runtimeState.overlay;

      expect(inputValue).toBe("");
      expect(overlay).not.toBeNull();
      if (!overlay) {
        throw new Error("Expected the commands overlay to open");
      }
      expect(overlay.title).toBe("Commands");

      const text = collectText(renderOverlay(state.theme, overlay));
      expect(text).toContain("Commands");
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

      const overlay = runtimeState.overlay;

      expect(overlay).not.toBeNull();
      if (!overlay) {
        throw new Error("Expected the input history overlay to open");
      }
      expect(overlay.title).toBe("Input history");

      const selectNode = findNodeWithKeyPress(
        renderOverlay(state.theme, overlay),
      );
      expect(selectNode).not.toBeNull();
      if (!selectNode) {
        throw new Error("Expected overlay to contain a Select root");
      }

      selectNode.props.onKeyPress?.("enter");

      expect(runtimeState.overlay).toBeNull();
      expect(inputValue).toBe(rawPrompt);
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

    try {
      expect(controller.handleCommand("new", state)).toBe(true);
      await Bun.sleep(0);

      expect(reloadCount).toBe(1);
      expect(state.session).toBeNull();
      expect(state.messages).toEqual([]);
      expect(state.stats).toEqual({
        totalInput: 0,
        totalOutput: 0,
        totalCost: 0,
      });
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
});
