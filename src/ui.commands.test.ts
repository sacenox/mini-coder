import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import type { ContainerNode, Node } from "@cel-tui/types";
import { registerFauxProvider } from "@mariozechner/pi-ai";
import type { AppState } from "./index.ts";
import { COMMANDS } from "./input.ts";
import { appendPromptHistory, openDatabase } from "./session.ts";
import { DEFAULT_THEME } from "./theme.ts";
import {
  createCommandController,
  formatPromptHistoryPreview,
  formatRelativeDate,
} from "./ui/commands.ts";
import type { ActiveOverlay } from "./ui/overlay.ts";
import { renderOverlay } from "./ui/overlay.ts";

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

function createTestState(): AppState {
  const db = openDatabase(":memory:");
  const cwd = "/tmp/mini-coder-ui-commands-test";
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
    settingsPath: join(cwd, "settings.json"),
    cwd,
    canonicalCwd: cwd,
    running: false,
    abortController: null,
    showReasoning: true,
    verbose: false,
  };
}

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
      openInBrowser: () => {},
    });

    try {
      expect(controller.handleCommand("unknown", state)).toBe(false);
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
      openInBrowser: () => {},
    });

    try {
      controller.applyModelSelection(state, model);

      expect(state.model).toBe(model);
      expect(state.settings.defaultModel).toBe(`${model.provider}/${model.id}`);
    } finally {
      faux.unregister();
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
