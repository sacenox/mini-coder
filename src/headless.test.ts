import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FauxProviderRegistration } from "@mariozechner/pi-ai";
import {
  fauxAssistantMessage,
  fauxText,
  fauxThinking,
  fauxToolCall,
  registerFauxProvider,
} from "@mariozechner/pi-ai";
import { runHeadlessPrompt, runHeadlessPromptText } from "./headless.ts";
import type { AppState } from "./index.ts";
import { listPromptHistory, loadMessages, openDatabase } from "./session.ts";
import { DEFAULT_THEME } from "./theme.ts";

let tmp: string;
let faux: FauxProviderRegistration;
const states: AppState[] = [];

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "mc-headless-"));
  faux = registerFauxProvider();
});

afterEach(() => {
  faux.unregister();
  for (const state of states.splice(0)) {
    state.db.close();
  }
  rmSync(tmp, { recursive: true, force: true });
});

function createTestState(): AppState {
  const state: AppState = {
    db: openDatabase(":memory:"),
    session: null,
    model: faux.getModel(),
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
    settingsPath: join(tmp, "settings.json"),
    cwd: tmp,
    canonicalCwd: tmp,
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
  states.push(state);
  return state;
}

function parseEventLines(lines: string[]): Array<Record<string, unknown>> {
  return lines.map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe("headless", () => {
  test("runHeadlessPrompt streams only completed NDJSON events and persists the completed turn", async () => {
    faux.setResponses([
      fauxAssistantMessage([
        fauxThinking("Need to inspect the failing test."),
        fauxText("Done."),
      ]),
    ]);
    const state = createTestState();
    const lines: string[] = [];

    const stopReason = await runHeadlessPrompt(state, "fix the tests", {
      writeLine: (line) => {
        lines.push(line);
      },
    });

    const events = parseEventLines(lines);
    expect(stopReason).toBe("stop");
    expect(events.map((event) => event.type)).toEqual([
      "assistant_message",
      "done",
    ]);

    const sessionId = state.session?.id;
    if (!sessionId) {
      throw new Error("Expected a session to be created");
    }

    expect(
      loadMessages(state.db, sessionId).map((message) => message.role),
    ).toEqual(["user", "assistant"]);
    expect(listPromptHistory(state.db, 1)[0]?.text).toBe("fix the tests");
  });

  test("runHeadlessPromptText writes only the final assistant text", async () => {
    faux.setResponses([
      fauxAssistantMessage(
        [fauxToolCall("shell", { command: "printf intermediate" })],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage([
        fauxThinking("Need to summarize the result."),
        fauxText("Done."),
      ]),
    ]);
    const state = createTestState();
    let output = "";

    const stopReason = await runHeadlessPromptText(
      state,
      "run the shell command",
      {
        writeText: (text) => {
          output += text;
        },
      },
    );

    expect(stopReason).toBe("stop");
    expect(output).toBe("Done.");

    const sessionId = state.session?.id;
    if (!sessionId) {
      throw new Error("Expected a session to be created");
    }

    expect(
      loadMessages(state.db, sessionId).map((message) => message.role),
    ).toEqual(["user", "assistant", "toolResult", "assistant"]);
    expect(listPromptHistory(state.db, 1)[0]?.text).toBe(
      "run the shell command",
    );
  });

  test("runHeadlessPromptText emits only assistant commentary snippets as activity output", async () => {
    faux.setResponses([
      fauxAssistantMessage(
        [
          fauxThinking("Need to inspect the tests first."),
          fauxText("I'll inspect the tests first."),
          fauxToolCall("shell", { command: "printf hidden-tool-call" }),
        ],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage([
        fauxThinking("Need to summarize the result."),
        fauxText("Done."),
      ]),
    ]);
    const state = createTestState();
    let activity = "";
    let output = "";

    const stopReason = await runHeadlessPromptText(
      state,
      "run the shell command",
      {
        writeActivity: (text) => {
          activity += text;
        },
        writeText: (text) => {
          output += text;
        },
      },
    );

    expect(stopReason).toBe("stop");
    expect(activity).toBe("I'll inspect the tests first.\n");
    expect(activity).not.toContain("Need to inspect the tests first.");
    expect(activity).not.toContain("hidden-tool-call");
    expect(activity).not.toContain("Done.");
    expect(output).toBe("Done.");
  });

  test("runHeadlessPrompt waits for async NDJSON writers before returning", async () => {
    faux.setResponses([fauxAssistantMessage("Done.")]);
    const state = createTestState();
    const lines: string[] = [];

    const stopReason = await runHeadlessPrompt(state, "fix the tests", {
      writeLine: async (line) => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        lines.push(line);
      },
    });

    expect(stopReason).toBe("stop");
    expect(parseEventLines(lines).map((event) => event.type)).toEqual([
      "assistant_message",
      "done",
    ]);
  });

  test("runHeadlessPromptText waits for async activity and final-text writers before returning", async () => {
    faux.setResponses([
      fauxAssistantMessage(
        [
          fauxText("I'll inspect the tests first."),
          fauxToolCall("shell", { command: "printf intermediate" }),
        ],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("Done."),
    ]);
    const state = createTestState();
    let activity = "";
    let output = "";

    const stopReason = await runHeadlessPromptText(state, "reply once", {
      writeActivity: async (text) => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        activity += text;
      },
      writeText: async (text) => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        output += text;
      },
    });

    expect(stopReason).toBe("stop");
    expect(activity).toBe("I'll inspect the tests first.\n");
    expect(output).toBe("Done.");
  });

  test("runHeadlessPrompt rejects slash commands before creating a session", async () => {
    const state = createTestState();
    const lines: string[] = [];

    await expect(
      runHeadlessPrompt(state, "/help", {
        writeLine: (line) => {
          lines.push(line);
        },
      }),
    ).rejects.toThrow(/slash commands: \/help/);

    expect(lines).toEqual([]);
    expect(state.session).toBeNull();
    expect(listPromptHistory(state.db, 1)).toEqual([]);
  });

  test("runHeadlessPrompt streams only completed events for tool-use turns", async () => {
    faux.setResponses([
      fauxAssistantMessage(
        [fauxToolCall("shell", { command: "printf tool-output" })],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("Done."),
    ]);
    const state = createTestState();
    const lines: string[] = [];

    const stopReason = await runHeadlessPrompt(state, "run the shell command", {
      writeLine: (line) => {
        lines.push(line);
      },
    });

    const events = parseEventLines(lines);
    expect(stopReason).toBe("stop");
    expect(events.map((event) => event.type)).toEqual([
      "assistant_message",
      "tool_result",
      "assistant_message",
      "done",
    ]);

    const sessionId = state.session?.id;
    if (!sessionId) {
      throw new Error("Expected a session to be created");
    }

    expect(
      loadMessages(state.db, sessionId).map((message) => message.role),
    ).toEqual(["user", "assistant", "toolResult", "assistant"]);
  });

  test("runHeadlessPrompt emits a terminal aborted event when interrupted during tool execution", async () => {
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall("shell", { command: "sleep 5" })], {
        stopReason: "toolUse",
      }),
    ]);
    const state = createTestState();
    const lines: string[] = [];

    const stopReason = await runHeadlessPrompt(state, "interrupt the shell", {
      writeLine: (line) => {
        lines.push(line);
        const event = JSON.parse(line) as { type?: string };
        if (event.type === "assistant_message") {
          state.abortController?.abort();
        }
      },
    });

    const events = parseEventLines(lines);
    expect(stopReason).toBe("aborted");
    expect(events.map((event) => event.type)).toEqual([
      "assistant_message",
      "tool_result",
      "aborted",
    ]);

    const abortedEvent = events.at(-1);
    const message = abortedEvent?.message;
    if (typeof message !== "object" || !message || !("stopReason" in message)) {
      throw new Error(
        "Expected the terminal aborted event to include a message",
      );
    }
    expect(message.stopReason).toBe("aborted");
  });

  test("runHeadlessPrompt treats broken stdout pipes as a quiet shutdown", async () => {
    faux.setResponses([fauxAssistantMessage("Done.")]);
    const state = createTestState();
    const brokenPipe = Object.assign(new Error("broken pipe"), {
      code: "EPIPE",
    });

    const stopReason = await runHeadlessPrompt(state, "reply once", {
      writeLine: () => {
        throw brokenPipe;
      },
    });

    expect(stopReason).toBe("stop");
    expect(state.running).toBe(false);
    expect(state.abortController).toBeNull();
  });
});
