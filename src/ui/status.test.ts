import { describe, expect, test } from "bun:test";
import {
  fauxAssistantMessage,
  registerFauxProvider,
} from "@mariozechner/pi-ai";
import type { AppState } from "../index.ts";
import { createUiMessage, openDatabase } from "../session.ts";
import { DEFAULT_SHOW_REASONING, DEFAULT_VERBOSE } from "../settings.ts";
import { DEFAULT_THEME } from "../theme.ts";
import { renderStatusBar } from "./status.ts";

interface RenderedStatusPill {
  text: string;
  bgColor: string | undefined;
  fgColor: string | undefined;
}

function renderStatusPills(
  state: AppState,
  cols?: number,
): RenderedStatusPill[] {
  const bar = renderStatusBar(state, cols);
  if (bar.type !== "hstack") {
    throw new Error("Expected the status bar root to be an hstack");
  }

  return bar.children.flatMap((child) => {
    if (child.type !== "hstack") {
      return [];
    }
    const [textNode] = child.children;
    if (!textNode || textNode.type !== "text") {
      return [];
    }
    return [
      {
        text: textNode.content,
        bgColor: child.props.bgColor,
        fgColor: textNode.props.fgColor,
      },
    ];
  });
}

function renderStatusText(state: AppState, cols?: number): string[] {
  return renderStatusPills(state, cols)
    .map((pill) => pill.text)
    .filter(Boolean);
}

function getModelPill(state: AppState): RenderedStatusPill {
  const [modelPill] = renderStatusPills(state);
  if (!modelPill) {
    throw new Error("Expected a model pill");
  }
  return modelPill;
}

function getUsagePill(state: AppState): RenderedStatusPill {
  const pills = renderStatusPills(state);
  const usage = pills.at(-1);
  if (!usage) {
    throw new Error("Expected a usage pill");
  }
  return usage;
}

function getUsageSummary(state: AppState): string {
  return getUsagePill(state).text;
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

  test("renderStatusBar maps reasoning effort levels to the model pill tone scale", () => {
    const faux = registerFauxProvider();
    const state = createTestState();
    state.model = faux.getModel();

    try {
      const cases = [
        { effort: "low", bgColor: "color02", fgColor: "color00" },
        { effort: "medium", bgColor: "color06", fgColor: "color00" },
        { effort: "high", bgColor: "color05", fgColor: "color15" },
        { effort: "xhigh", bgColor: "color09", fgColor: "color00" },
      ] as const;

      for (const testCase of cases) {
        state.effort = testCase.effort;
        expect(getModelPill(state)).toMatchObject({
          text: `${state.model.provider}/${state.model.id} · ${testCase.effort === "medium" ? "med" : testCase.effort}`,
          bgColor: testCase.bgColor,
          fgColor: testCase.fgColor,
        });
      }
    } finally {
      faux.unregister();
      state.db.close();
    }
  });

  test("renderStatusBar maps context usage bands to the usage pill tone scale", () => {
    const faux = registerFauxProvider();
    const state = createTestState();
    state.model = {
      ...faux.getModel(),
      contextWindow: 100,
    };

    try {
      const cases = [
        { totalTokens: 10, bgColor: "color02", fgColor: "color00" },
        { totalTokens: 30, bgColor: "color06", fgColor: "color00" },
        { totalTokens: 60, bgColor: "color05", fgColor: "color15" },
        { totalTokens: 80, bgColor: "color01", fgColor: "color15" },
        { totalTokens: 95, bgColor: "color09", fgColor: "color00" },
      ] as const;

      for (const testCase of cases) {
        state.messages = [
          makeAssistantWithUsage("context anchor", {
            totalTokens: testCase.totalTokens,
          }),
        ];
        expect(getUsagePill(state)).toMatchObject({
          text: `in:0 out:0 · ${testCase.totalTokens.toFixed(1)}%/100 · $0.00`,
          bgColor: testCase.bgColor,
          fgColor: testCase.fgColor,
        });
      }
    } finally {
      faux.unregister();
      state.db.close();
    }
  });

  test("renderStatusBar colors the model and usage pills independently", () => {
    const faux = registerFauxProvider();
    const state = createTestState();
    state.model = {
      ...faux.getModel(),
      contextWindow: 100,
    };

    try {
      state.effort = "xhigh";
      state.messages = [
        makeAssistantWithUsage("cold context", { totalTokens: 10 }),
      ];
      expect(getModelPill(state)).toMatchObject({
        bgColor: "color09",
        fgColor: "color00",
      });
      expect(getUsagePill(state)).toMatchObject({
        bgColor: "color02",
        fgColor: "color00",
      });

      state.effort = "low";
      state.messages = [
        makeAssistantWithUsage("hot context", { totalTokens: 95 }),
      ];
      expect(getModelPill(state)).toMatchObject({
        bgColor: "color02",
        fgColor: "color00",
      });
      expect(getUsagePill(state)).toMatchObject({
        bgColor: "color09",
        fgColor: "color00",
      });
    } finally {
      faux.unregister();
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
