import type { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AssistantMessage, UserMessage } from "@mariozechner/pi-ai";
import {
  type FauxProviderRegistration,
  fauxAssistantMessage,
  fauxToolCall,
  registerFauxProvider,
} from "@mariozechner/pi-ai";
import {
  type AgentEvent,
  type AgentTool,
  runAgentLoop,
  type ToolExecResult,
} from "./agent.ts";
import {
  appendMessage,
  createSession,
  loadMessages,
  openDatabase,
} from "./session.ts";
import {
  editTool,
  executeEdit,
  executeShell,
  shellTool,
  type ToolResult,
} from "./tools.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmp: string;
let db: Database;
let faux: FauxProviderRegistration;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "mc-agent-"));
  db = openDatabase(":memory:");
  faux = registerFauxProvider();
});

afterEach(() => {
  faux.unregister();
  db.close();
  rmSync(tmp, { recursive: true, force: true });
});

function makeUser(text: string): UserMessage {
  return { role: "user", content: text, timestamp: Date.now() };
}

/** Wrap a text-only ToolResult into a ToolExecResult with content blocks. */
function wrapResult(r: ToolResult): ToolExecResult {
  return { content: [{ type: "text", text: r.text }], isError: r.isError };
}

/** Create standard built-in tools for tests. */
function builtinTools(): AgentTool[] {
  return [
    {
      definition: shellTool,
      execute: async (args, cwd) =>
        wrapResult(
          await executeShell({ command: args.command as string }, cwd),
        ),
    },
    {
      definition: editTool,
      execute: (args, cwd) =>
        wrapResult(
          executeEdit(
            {
              path: args.path as string,
              oldText: args.oldText as string,
              newText: args.newText as string,
            },
            cwd,
          ),
        ),
    },
  ];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("agent loop", () => {
  test("simple text response appends assistant message", async () => {
    faux.setResponses([fauxAssistantMessage("Hello back!")]);

    const session = createSession(db, { cwd: tmp });
    const userMsg = makeUser("hello");
    const turn = appendMessage(db, session.id, userMsg);

    const result = await runAgentLoop({
      db,
      sessionId: session.id,
      turn,
      model: faux.getModel(),
      systemPrompt: "Test",
      tools: [],
      messages: [userMsg],
      cwd: tmp,
    });

    expect(result.messages).toHaveLength(2);
    expect(result.messages[1]!.role).toBe("assistant");
    const am = result.messages[1] as AssistantMessage;
    expect(am.stopReason).toBe("stop");
  });

  test("simple text response persists to DB", async () => {
    faux.setResponses([fauxAssistantMessage("Hello back!")]);
    const session = createSession(db, { cwd: tmp });
    const userMsg = makeUser("hello");
    const turn = appendMessage(db, session.id, userMsg);

    await runAgentLoop({
      db,
      sessionId: session.id,
      turn,
      model: faux.getModel(),
      systemPrompt: "Test",
      tools: [],
      messages: [userMsg],
      cwd: tmp,
    });

    const dbMessages = loadMessages(db, session.id);
    expect(dbMessages).toHaveLength(2);
    expect(dbMessages[0]!.role).toBe("user");
    expect(dbMessages[1]!.role).toBe("assistant");
  });

  test("executes tool calls and appends results", async () => {
    faux.setResponses([
      // First response: call shell tool
      fauxAssistantMessage(
        [fauxToolCall("shell", { command: "echo tool-output" })],
        { stopReason: "toolUse" },
      ),
      // Second response: after tool result, reply with text
      fauxAssistantMessage("Done! The output was tool-output."),
    ]);

    const session = createSession(db, { cwd: tmp });
    const userMsg = makeUser("run echo");
    const turn = appendMessage(db, session.id, userMsg);

    const result = await runAgentLoop({
      db,
      sessionId: session.id,
      turn,
      model: faux.getModel(),
      systemPrompt: "Test",
      tools: builtinTools(),
      messages: [userMsg],
      cwd: tmp,
    });

    // user → assistant(toolCall) → toolResult → assistant(text)
    expect(result.messages).toHaveLength(4);
    expect(result.messages[0]!.role).toBe("user");
    expect(result.messages[1]!.role).toBe("assistant");
    expect(result.messages[2]!.role).toBe("toolResult");
    expect(result.messages[3]!.role).toBe("assistant");
    expect((result.messages[3] as AssistantMessage).stopReason).toBe("stop");

    // DB should match
    const dbMessages = loadMessages(db, session.id);
    expect(dbMessages).toHaveLength(4);
  });

  test("handles multiple tool calls in a single response", async () => {
    writeFileSync(join(tmp, "file.txt"), "original content");

    faux.setResponses([
      // One response with two tool calls
      fauxAssistantMessage(
        [
          fauxToolCall("shell", { command: "echo first" }),
          fauxToolCall("edit", {
            path: "file.txt",
            oldText: "original",
            newText: "modified",
          }),
        ],
        { stopReason: "toolUse" },
      ),
      // Follow-up
      fauxAssistantMessage("Both done."),
    ]);

    const session = createSession(db, { cwd: tmp });
    const userMsg = makeUser("do both");
    const turn = appendMessage(db, session.id, userMsg);

    const result = await runAgentLoop({
      db,
      sessionId: session.id,
      turn,
      model: faux.getModel(),
      systemPrompt: "Test",
      tools: builtinTools(),
      messages: [userMsg],
      cwd: tmp,
    });

    // user → assistant(2 toolCalls) → toolResult × 2 → assistant(text)
    expect(result.messages).toHaveLength(5);
    expect(result.messages[2]!.role).toBe("toolResult");
    expect(result.messages[3]!.role).toBe("toolResult");
    expect(result.messages[4]!.role).toBe("assistant");
  });

  test("chains multiple tool-use rounds", async () => {
    faux.setResponses([
      // Round 1: tool call
      fauxAssistantMessage(
        [fauxToolCall("shell", { command: "echo round1" })],
        { stopReason: "toolUse" },
      ),
      // Round 2: another tool call after seeing result
      fauxAssistantMessage(
        [fauxToolCall("shell", { command: "echo round2" })],
        { stopReason: "toolUse" },
      ),
      // Round 3: done
      fauxAssistantMessage("All rounds complete."),
    ]);

    const session = createSession(db, { cwd: tmp });
    const userMsg = makeUser("chain");
    const turn = appendMessage(db, session.id, userMsg);

    const result = await runAgentLoop({
      db,
      sessionId: session.id,
      turn,
      model: faux.getModel(),
      systemPrompt: "Test",
      tools: builtinTools(),
      messages: [userMsg],
      cwd: tmp,
    });

    // user → assistant(tc) → toolResult → assistant(tc) → toolResult → assistant(text)
    expect(result.messages).toHaveLength(6);
    expect(result.stopReason).toBe("stop");
  });

  test("all messages in loop share the same turn number", async () => {
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall("shell", { command: "echo hi" })], {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage("Done."),
    ]);

    const session = createSession(db, { cwd: tmp });
    const userMsg = makeUser("test turns");
    const turn = appendMessage(db, session.id, userMsg);

    await runAgentLoop({
      db,
      sessionId: session.id,
      turn,
      model: faux.getModel(),
      systemPrompt: "Test",
      tools: builtinTools(),
      messages: [userMsg],
      cwd: tmp,
    });

    // All messages should be in the same turn — undo should remove everything
    const dbMessages = loadMessages(db, session.id);
    expect(dbMessages).toHaveLength(4); // user + assistant + toolResult + assistant

    // Undo should remove all of them (same turn)
    const { undoLastTurn } = await import("./session.ts");
    undoLastTurn(db, session.id);
    expect(loadMessages(db, session.id)).toHaveLength(0);
  });

  test("emits events during streaming", async () => {
    faux.setResponses([fauxAssistantMessage("Hello world")]);

    const events: AgentEvent[] = [];

    const session = createSession(db, { cwd: tmp });
    const userMsg = makeUser("hi");
    const turn = appendMessage(db, session.id, userMsg);

    await runAgentLoop({
      db,
      sessionId: session.id,
      turn,
      model: faux.getModel(),
      systemPrompt: "Test",
      tools: [],
      messages: [userMsg],
      cwd: tmp,
      onEvent: (e) => events.push(e),
    });

    const textDeltas = events.filter((e) => e.type === "text_delta");
    expect(textDeltas.length).toBeGreaterThan(0);

    const doneEvents = events.filter((e) => e.type === "done");
    expect(doneEvents).toHaveLength(1);
  });

  test("emits tool events during tool execution", async () => {
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall("shell", { command: "echo test" })], {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage("Done."),
    ]);

    const events: AgentEvent[] = [];

    const session = createSession(db, { cwd: tmp });
    const userMsg = makeUser("go");
    const turn = appendMessage(db, session.id, userMsg);

    await runAgentLoop({
      db,
      sessionId: session.id,
      turn,
      model: faux.getModel(),
      systemPrompt: "Test",
      tools: builtinTools(),
      messages: [userMsg],
      cwd: tmp,
      onEvent: (e) => events.push(e),
    });

    const toolStarts = events.filter((e) => e.type === "tool_start");
    const toolEnds = events.filter((e) => e.type === "tool_end");
    expect(toolStarts).toHaveLength(1);
    expect(toolEnds).toHaveLength(1);
  });

  test("interrupt preserves partial response", async () => {
    faux.setResponses([
      fauxAssistantMessage("This response will be interrupted"),
    ]);

    // Pre-abort so the faux provider immediately returns an aborted message
    const controller = new AbortController();
    controller.abort();

    const session = createSession(db, { cwd: tmp });
    const userMsg = makeUser("long task");
    const turn = appendMessage(db, session.id, userMsg);

    const result = await runAgentLoop({
      db,
      sessionId: session.id,
      turn,
      model: faux.getModel(),
      systemPrompt: "Test",
      tools: [],
      messages: [userMsg],
      cwd: tmp,
      signal: controller.signal,
    });

    expect(result.stopReason).toBe("aborted");
    // Partial message should be in messages
    expect(result.messages).toHaveLength(2);
    const lastMsg = result.messages[
      result.messages.length - 1
    ] as AssistantMessage;
    expect(lastMsg.role).toBe("assistant");
    expect(lastMsg.stopReason).toBe("aborted");

    // Should be persisted to DB
    const dbMessages = loadMessages(db, session.id);
    const dbLast = dbMessages[dbMessages.length - 1] as AssistantMessage;
    expect(dbLast.role).toBe("assistant");
    expect(dbLast.stopReason).toBe("aborted");
  });

  test("handles LLM error gracefully", async () => {
    faux.setResponses([
      fauxAssistantMessage("", {
        stopReason: "error",
        errorMessage: "Rate limit exceeded",
      }),
    ]);

    const session = createSession(db, { cwd: tmp });
    const userMsg = makeUser("trigger error");
    const turn = appendMessage(db, session.id, userMsg);

    const result = await runAgentLoop({
      db,
      sessionId: session.id,
      turn,
      model: faux.getModel(),
      systemPrompt: "Test",
      tools: [],
      messages: [userMsg],
      cwd: tmp,
    });

    expect(result.stopReason).toBe("error");
  });

  test("handles unknown tool name gracefully", async () => {
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall("nonexistent_tool", { foo: "bar" })], {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage("I see the error, let me try again."),
    ]);

    const session = createSession(db, { cwd: tmp });
    const userMsg = makeUser("test unknown tool");
    const turn = appendMessage(db, session.id, userMsg);

    const result = await runAgentLoop({
      db,
      sessionId: session.id,
      turn,
      model: faux.getModel(),
      systemPrompt: "Test",
      tools: builtinTools(),
      messages: [userMsg],
      cwd: tmp,
    });

    // Should still complete — the error tool result lets the model self-correct
    expect(result.messages.length).toBeGreaterThanOrEqual(4);
    // The tool result should be an error
    const toolResult = result.messages.find((m) => m.role === "toolResult");
    expect(toolResult).toBeDefined();
    if (toolResult?.role === "toolResult") {
      expect(toolResult.isError).toBe(true);
    }
  });

  test("stopReason 'length' returns without looping", async () => {
    faux.setResponses([
      fauxAssistantMessage("Partial response that hit the token limit", {
        stopReason: "length",
      }),
    ]);

    const session = createSession(db, { cwd: tmp });
    const userMsg = makeUser("big question");
    const turn = appendMessage(db, session.id, userMsg);

    const result = await runAgentLoop({
      db,
      sessionId: session.id,
      turn,
      model: faux.getModel(),
      systemPrompt: "Test",
      tools: [],
      messages: [userMsg],
      cwd: tmp,
    });

    expect(result.stopReason).toBe("length");
    expect(result.messages).toHaveLength(2);
  });
});
