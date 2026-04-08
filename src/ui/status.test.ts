import { describe, expect, test } from "bun:test";
import type { Node } from "@cel-tui/types";
import {
  fauxAssistantMessage,
  registerFauxProvider,
} from "@mariozechner/pi-ai";
import type { AppState } from "../index.ts";
import { createUiMessage, openDatabase } from "../session.ts";
import { DEFAULT_SHOW_REASONING, DEFAULT_VERBOSE } from "../settings.ts";
import { DEFAULT_THEME } from "../theme.ts";
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

function renderStatusText(state: AppState, cols?: number): string[] {
  return collectText(renderStatusBar(state, cols)).filter(Boolean);
}

function getUsageSummary(state: AppState): string {
  const usage = renderStatusText(state).at(-1);
  if (!usage) {
    throw new Error("Expected a usage summary");
  }
  return usage;
}

function getUsagePercent(state: AppState): number {
  const match = /· ([\d.]+)%\//.exec(getUsageSummary(state));
  if (!match) {
    throw new Error("Expected a context percentage in the usage summary");
  }
  return Number(match[1]);
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
  test("renderStatusBar shows model cwd git and usage summaries in reading order", () => {
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

    try {
      expect(renderStatusText(state)).toEqual([
        `${state.model.provider}/${state.model.id} · med`,
        state.cwd,
        "main +1 ~2 ?3 ▲ 4",
        "in:0 out:0 · 0.0%/128k · $0.00",
      ]);
    } finally {
      faux.unregister();
      state.db.close();
    }
  });

  test("renderStatusBar left-truncates the cwd on narrow terminals", () => {
    const state = createTestState();
    state.cwd = "/tmp/very/long/path/to/mini-coder";

    try {
      expect(renderStatusText(state, 30)).toEqual(["no model", "…/mini-coder"]);
    } finally {
      state.db.close();
    }
  });

  test("renderStatusBar uses the latest valid assistant usage as an anchor and ignores trailing UI-only messages", () => {
    const faux = registerFauxProvider();
    const state = createTestState();
    state.model = {
      ...faux.getModel(),
      contextWindow: 1_000,
    };
    state.stats = {
      totalInput: 4_000,
      totalOutput: 2_000,
      totalCost: 1.23,
    };

    try {
      state.messages = [
        { role: "user", content: "first", timestamp: 1 },
        makeAssistantWithUsage("Second.", {
          input: 200,
          output: 50,
          totalTokens: 250,
        }),
      ];
      const anchoredPercent = getUsagePercent(state);

      state.messages = [...state.messages, createUiMessage("x".repeat(5_000))];
      const withUiOnlyPercent = getUsagePercent(state);

      state.messages = [
        ...state.messages,
        { role: "user", content: "12345678", timestamp: 2 },
      ];
      const withTrailingUserPercent = getUsagePercent(state);

      state.messages = [
        ...state.messages,
        {
          role: "toolResult",
          toolCallId: "tool-1",
          toolName: "shell",
          content: [{ type: "text", text: "done" }],
          isError: false,
          timestamp: 3,
        },
      ];
      const withToolResultPercent = getUsagePercent(state);

      expect(getUsageSummary(state)).toBe(
        `in:4.0k out:2.0k · ${withToolResultPercent.toFixed(1)}%/1k · $1.23`,
      );
      expect(withUiOnlyPercent).toBe(anchoredPercent);
      expect(withTrailingUserPercent).toBeGreaterThan(anchoredPercent);
      expect(withToolResultPercent).toBeGreaterThan(withTrailingUserPercent);
    } finally {
      faux.unregister();
      state.db.close();
    }
  });

  test("renderStatusBar estimates context usage from model-visible messages before the first assistant response", () => {
    const faux = registerFauxProvider();
    const state = createTestState();
    state.model = {
      ...faux.getModel(),
      contextWindow: 100,
    };

    try {
      state.messages = [{ role: "user", content: "12345678", timestamp: 1 }];
      const initialPercent = getUsagePercent(state);

      state.messages = [createUiMessage("x".repeat(5_000)), ...state.messages];
      const withUiOnlyPercent = getUsagePercent(state);

      state.messages = [
        ...state.messages,
        { role: "user", content: "more visible text", timestamp: 2 },
      ];
      const withSecondUserPercent = getUsagePercent(state);

      expect(initialPercent).toBeGreaterThan(0);
      expect(withUiOnlyPercent).toBe(initialPercent);
      expect(withSecondUserPercent).toBeGreaterThan(initialPercent);
    } finally {
      faux.unregister();
      state.db.close();
    }
  });

  test("renderStatusBar skips aborted assistant usage as a context anchor", () => {
    const faux = registerFauxProvider();
    const abortedLowUsage = makeAssistantWithUsage("abcdefghi", {
      input: 10,
      output: 10,
      totalTokens: 20,
    });
    abortedLowUsage.stopReason = "aborted";
    const abortedHighUsage = makeAssistantWithUsage("abcdefghi", {
      input: 700,
      output: 200,
      totalTokens: 900,
    });
    abortedHighUsage.stopReason = "aborted";

    const buildState = (aborted: ReturnType<typeof makeAssistantWithUsage>) => {
      const state = createTestState();
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
      return state;
    };

    const lowUsageState = buildState(abortedLowUsage);
    const highUsageState = buildState(abortedHighUsage);

    try {
      expect(getUsagePercent(lowUsageState)).toBe(
        getUsagePercent(highUsageState),
      );
    } finally {
      lowUsageState.db.close();
      highUsageState.db.close();
      faux.unregister();
    }
  });

  test("renderStatusBar falls back to usage components when totalTokens is zero", () => {
    const faux = registerFauxProvider();
    const fromComponents = createTestState();
    const fromTotalTokens = createTestState();
    fromComponents.model = {
      ...faux.getModel(),
      contextWindow: 1_000,
    };
    fromTotalTokens.model = {
      ...faux.getModel(),
      contextWindow: 1_000,
    };
    fromComponents.messages = [
      makeAssistantWithUsage("fallback", {
        input: 120,
        output: 30,
        cacheRead: 25,
        cacheWrite: 25,
        totalTokens: 0,
      }),
    ];
    fromTotalTokens.messages = [
      makeAssistantWithUsage("fallback", {
        input: 120,
        output: 30,
        cacheRead: 25,
        cacheWrite: 25,
        totalTokens: 200,
      }),
    ];

    try {
      expect(getUsagePercent(fromComponents)).toBe(
        getUsagePercent(fromTotalTokens),
      );
    } finally {
      fromComponents.db.close();
      fromTotalTokens.db.close();
      faux.unregister();
    }
  });
});
