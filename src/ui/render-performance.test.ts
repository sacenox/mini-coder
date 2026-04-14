import { afterEach, describe, test } from "bun:test";
import { cel, MockTerminal } from "@cel-tui/core";
import type { Node } from "@cel-tui/types";
import {
  fauxAssistantMessage,
  fauxThinking,
  fauxToolCall,
} from "@mariozechner/pi-ai";
import type { AppState } from "../index.ts";
import {
  computeContextTokens,
  computeStats,
  createUiMessage,
  openDatabase,
} from "../session.ts";
import { DEFAULT_SHOW_REASONING, DEFAULT_VERBOSE } from "../settings.ts";
import { DEFAULT_THEME } from "../theme.ts";
import {
  buildConversationLogNodes,
  resetConversationRenderCache,
} from "../ui/conversation.ts";
import {
  createInputController,
  renderActiveOverlay,
  renderBaseLayout,
  resetUiState,
} from "../ui.ts";

const VIEWPORT_COLS = 120;
const VIEWPORT_ROWS = 40;
const TYPING_SAMPLE_COUNT = 9;
const LARGE_MARKDOWN_SECTION_COUNT = 8;
const NODE_BUDGET = 6_000;
const TYPING_MEDIAN_BUDGET_MS = 40;

function flushCelRender(): Promise<void> {
  return new Promise((resolve) => {
    process.nextTick(resolve);
  });
}

function startUiViewport(
  state: AppState,
  terminal: MockTerminal,
  controller: ReturnType<typeof createInputController>,
): void {
  cel.init(terminal);
  cel.viewport(() => {
    const base = renderBaseLayout(state, terminal.columns, controller);
    const overlay = renderActiveOverlay(state);
    return overlay ? [base, overlay] : base;
  });
}

function createTestState(): AppState {
  const cwd = "/tmp/mini-coder-ui-render-perf-test";
  const model: NonNullable<AppState["model"]> = {
    id: "gpt-5.4",
    name: "gpt-5.4",
    provider: "openai-codex",
    api: "responses",
    baseUrl: "http://localhost:0",
    reasoning: true,
    input: ["text"],
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
    },
    contextWindow: 272_000,
    maxTokens: 8_192,
  };

  return {
    db: openDatabase(":memory:"),
    session: null,
    model,
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
    settingsPath: `${cwd}/settings.json`,
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

function setMessages(state: AppState, messages: AppState["messages"]): void {
  state.messages = messages;
  state.stats = computeStats(messages);
  state.contextTokens = computeContextTokens(messages);
}

function buildLargeMarkdown(seed: number): string {
  return Array.from({ length: LARGE_MARKDOWN_SECTION_COUNT }, (_, index) => {
    const section = seed * 100 + index;
    return [
      `# Section ${section}`,
      "",
      `Paragraph ${section}: ${"lorem ipsum dolor sit amet ".repeat(10)}`,
      "",
      `- item ${section}a with [link](https://example.com/${section})`,
      `- item ${section}b with **bold** text and \`inline_code_${section}\``,
      "",
      `> Quote ${section}: ${"wrapped quoted text ".repeat(10)}`,
      "",
      "```ts",
      `const value${section} = ${section};`,
      `console.log(value${section});`,
      "```",
    ].join("\n");
  }).join("\n\n");
}

function createLargeMarkdownMessages(): AppState["messages"] {
  return [
    {
      role: "user",
      content: "Investigate the rendering lag in this session.",
      timestamp: 1,
    },
    fauxAssistantMessage(buildLargeMarkdown(1), { timestamp: 2 }),
    {
      role: "user",
      content: "Keep going with the detailed write-up.",
      timestamp: 3,
    },
    fauxAssistantMessage(buildLargeMarkdown(2), { timestamp: 4 }),
    {
      role: "user",
      content: "Add one more large markdown response for history.",
      timestamp: 5,
    },
    fauxAssistantMessage(buildLargeMarkdown(3), { timestamp: 6 }),
  ];
}

function countNodes(node: Node): number {
  if (node.type === "text" || node.type === "textinput") {
    return 1;
  }

  return (
    1 + node.children.reduce((total, child) => total + countNodes(child), 0)
  );
}

function getConversationNode(
  messages: AppState["messages"],
  index: number,
): Node {
  resetConversationRenderCache();

  const nodes = buildConversationLogNodes(
    {
      messages,
      showReasoning: true,
      verbose: false,
      theme: DEFAULT_THEME,
      versionLabel: "dev",
    },
    {
      isStreaming: false,
      content: [],
      pendingToolResults: [],
    },
    0,
    80,
  );
  const node = nodes[index];

  if (!node) {
    throw new Error(`Expected a rendered node at index ${index}`);
  }

  return node;
}

function expectNodeCountAtMost(
  label: string,
  node: Node,
  maxNodes: number,
): void {
  const nodeCount = countNodes(node);

  if (nodeCount > maxNodes) {
    throw new Error(
      `Expected ${label} node count <= ${maxNodes}, got ${nodeCount}`,
    );
  }
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1]! + sorted[middle]!) / 2;
  }

  return sorted[middle]!;
}

async function measureTypingMedianRerenderMs(state: AppState): Promise<number> {
  const terminal = new MockTerminal(VIEWPORT_COLS, VIEWPORT_ROWS);
  const controller = createInputController(state);
  const samples: number[] = [];

  startUiViewport(state, terminal, controller);
  await flushCelRender();

  try {
    for (let index = 0; index < TYPING_SAMPLE_COUNT; index++) {
      const nextValue = index % 2 === 0 ? "a" : "ab";
      const start = performance.now();
      controller.onChange(nextValue);
      await flushCelRender();
      samples.push(performance.now() - start);
    }
  } finally {
    cel.stop();
  }

  return median(samples);
}

afterEach(() => {
  resetUiState();
  cel.stop();
});

describe("ui render performance", () => {
  test("renderBaseLayout with large historical assistant markdown stays within the node budget", () => {
    // Arrange
    const state = createTestState();
    setMessages(state, createLargeMarkdownMessages());
    const controller = createInputController(state);

    try {
      // Act
      const base = renderBaseLayout(state, VIEWPORT_COLS, controller);
      const nodeCount = countNodes(base);

      // Assert
      if (nodeCount > NODE_BUDGET) {
        throw new Error(
          `Expected large-markdown layout node count <= ${NODE_BUDGET}, got ${nodeCount}`,
        );
      }
    } finally {
      state.db.close();
    }
  });

  test("non-markdown conversation log items stay within bounded node budgets", () => {
    // Arrange
    const userNode = getConversationNode(
      [
        {
          role: "user",
          content: "lorem ipsum dolor sit amet ".repeat(400),
          timestamp: 1,
        },
      ],
      0,
    );
    const uiNode = getConversationNode(
      [createUiMessage("status update ".repeat(400))],
      0,
    );
    const thinkingNode = getConversationNode(
      [fauxAssistantMessage([fauxThinking("plan\n".repeat(400))])],
      0,
    );
    const assistantToolCallsNode = getConversationNode(
      [
        fauxAssistantMessage([
          fauxThinking("brief plan"),
          fauxToolCall(
            "shell",
            { command: "printf 'foo\\nbar'" },
            { id: "tool-1" },
          ),
          fauxToolCall(
            "edit",
            {
              path: "src/app.ts",
              oldText: "before",
              newText: "after",
            },
            { id: "tool-2" },
          ),
          fauxToolCall("readImage", { path: "diagram.png" }, { id: "tool-3" }),
        ]),
      ],
      0,
    );
    const longShellToolCallNode = getConversationNode(
      [
        fauxAssistantMessage([
          fauxToolCall(
            "shell",
            { command: `printf ${"x".repeat(300)}TAIL` },
            { id: "tool-4" },
          ),
        ]),
      ],
      0,
    );
    const shellResultNode = getConversationNode(
      [
        fauxAssistantMessage([
          fauxToolCall("shell", { command: "seq 1 200" }, { id: "tool-1" }),
        ]),
        {
          role: "toolResult",
          toolCallId: "tool-1",
          toolName: "shell",
          content: [
            {
              type: "text",
              text: Array.from(
                { length: 200 },
                (_, index) => `line ${index + 1}`,
              ).join("\n"),
            },
          ],
          isError: false,
          timestamp: 2,
        },
      ],
      1,
    );
    const editErrorNode = getConversationNode(
      [
        fauxAssistantMessage([
          fauxToolCall(
            "edit",
            {
              path: "src/app.ts",
              oldText: "before",
              newText: "after",
            },
            { id: "tool-2" },
          ),
        ]),
        {
          role: "toolResult",
          toolCallId: "tool-2",
          toolName: "edit",
          content: [
            {
              type: "text",
              text: Array.from(
                { length: 120 },
                (_, index) => `line ${index + 1}`,
              ).join("\n"),
            },
          ],
          isError: true,
          timestamp: 3,
        },
      ],
      1,
    );
    const genericResultNode = getConversationNode(
      [
        {
          role: "toolResult",
          toolCallId: "tool-3",
          toolName: "pluginSearch",
          content: [
            {
              type: "text",
              text: Array.from(
                { length: 200 },
                (_, index) => `row ${index + 1}`,
              ).join("\n"),
            },
          ],
          isError: false,
          timestamp: 4,
        },
      ],
      0,
    );

    // Assert
    expectNodeCountAtMost("long user message", userNode, 4);
    expectNodeCountAtMost("long UI message", uiNode, 4);
    expectNodeCountAtMost("thinking-only assistant message", thinkingNode, 4);
    expectNodeCountAtMost(
      "assistant tool-call bundle",
      assistantToolCallsNode,
      64,
    );
    expectNodeCountAtMost(
      "long single-token shell tool call",
      longShellToolCallNode,
      64,
    );
    expectNodeCountAtMost("shell tool-result preview", shellResultNode, 24);
    expectNodeCountAtMost("edit error preview", editErrorNode, 24);
    expectNodeCountAtMost("generic tool result", genericResultNode, 240);
  });

  test("typing into the input with large historical assistant markdown stays within the rerender budget", async () => {
    // Arrange
    const state = createTestState();
    setMessages(state, createLargeMarkdownMessages());

    try {
      // Act
      const medianRerenderMs = await measureTypingMedianRerenderMs(state);

      // Assert
      if (medianRerenderMs > TYPING_MEDIAN_BUDGET_MS) {
        throw new Error(
          `Expected typing median rerender <= ${TYPING_MEDIAN_BUDGET_MS}ms, got ${medianRerenderMs.toFixed(1)}ms`,
        );
      }
    } finally {
      state.db.close();
    }
  });
});
