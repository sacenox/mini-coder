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
import { runHeadlessPrompt } from "./headless.ts";
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
    showReasoning: true,
    verbose: false,
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
  test("runHeadlessPrompt streams NDJSON events and persists the completed turn", async () => {
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
    expect(events.some((event) => event.type === "thinking_delta")).toBe(true);
    expect(events.some((event) => event.type === "assistant_message")).toBe(
      true,
    );
    expect(events.at(-1)?.type).toBe("done");

    const sessionId = state.session?.id;
    if (!sessionId) {
      throw new Error("Expected a session to be created");
    }

    expect(
      loadMessages(state.db, sessionId).map((message) => message.role),
    ).toEqual(["user", "assistant"]);
    expect(listPromptHistory(state.db, 1)[0]?.text).toBe("fix the tests");
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
    ).rejects.toThrow("Headless mode does not support slash commands: /help");

    expect(lines).toEqual([]);
    expect(state.session).toBeNull();
    expect(listPromptHistory(state.db, 1)).toEqual([]);
  });

  test("runHeadlessPrompt streams tool execution events for tool-use turns", async () => {
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
    expect(events.some((event) => event.type === "tool_start")).toBe(true);
    expect(events.some((event) => event.type === "tool_delta")).toBe(true);
    expect(events.some((event) => event.type === "tool_end")).toBe(true);
    expect(events.some((event) => event.type === "tool_result")).toBe(true);

    const sessionId = state.session?.id;
    if (!sessionId) {
      throw new Error("Expected a session to be created");
    }

    expect(
      loadMessages(state.db, sessionId).map((message) => message.role),
    ).toEqual(["user", "assistant", "toolResult", "assistant"]);
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
