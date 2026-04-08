import { describe, expect, test } from "bun:test";
import type { Node } from "@cel-tui/types";
import {
  fauxAssistantMessage,
  registerFauxProvider,
} from "@mariozechner/pi-ai";
import type { AppState } from "../index.ts";
import { createUiMessage, openDatabase } from "../session.ts";
import { DEFAULT_SHOW_REASONING, DEFAULT_VERBOSE } from "../settings.ts";
import { DEFAULT_THEME, type Theme } from "../theme.ts";
import { renderStatusBar } from "./status.ts";

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
  const cwd = "/tmp/mini-coder-ui-status-test";
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
    settingsPath: `${cwd}/settings.json`,
    cwd,
    canonicalCwd: cwd,
    running: false,
    abortController: null,
    activeTurnPromise: null,
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

describe("ui/status", () => {
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

  test("renderStatusBar left-truncates the cwd on narrow terminals", () => {
    const state = createTestState();
    state.cwd = "/tmp/very/long/path/to/mini-coder";

    try {
      const node = renderStatusBar(state, 30);
      const text = collectText(node);

      expect(text).toContain("…/mini-coder");
      expect(text).not.toContain(state.cwd);
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
});
