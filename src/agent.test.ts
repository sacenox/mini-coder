import type { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  AssistantMessage,
  Context,
  Message,
  Model,
  Tool,
  Usage,
  UserMessage,
} from "@mariozechner/pi-ai";
import {
  createAssistantMessageEventStream,
  type FauxProviderRegistration,
  fauxAssistantMessage,
  fauxText,
  fauxThinking,
  fauxToolCall,
  registerApiProvider,
  registerFauxProvider,
  unregisterApiProviders,
} from "@mariozechner/pi-ai";
import { type AgentEvent, runAgentLoop, type ToolHandler } from "./agent.ts";
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
  executeTodoRead,
  executeTodoWrite,
  shellTool,
  todoReadTool,
  todoWriteTool,
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

function makeTodoSnapshotMessage(
  todos: Array<{
    content: string;
    status: "pending" | "in_progress" | "completed";
  }>,
): Message {
  return {
    role: "toolResult",
    toolCallId: `todo-${Date.now()}`,
    toolName: "todoWrite",
    content: [{ type: "text", text: JSON.stringify({ todos }) }],
    isError: false,
    timestamp: Date.now(),
  };
}

const ZERO_USAGE: Usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function isEventType<TType extends AgentEvent["type"]>(
  event: AgentEvent,
  type: TType,
): event is Extract<AgentEvent, { type: TType }> {
  return event.type === type;
}

function expectEvent<TType extends AgentEvent["type"]>(
  events: AgentEvent[],
  type: TType,
): Extract<AgentEvent, { type: TType }> {
  const event = events.find((candidate) => isEventType(candidate, type));
  if (!event) {
    throw new Error(`Expected a ${type} event`);
  }
  return event;
}

function expectLastEvent<TType extends AgentEvent["type"]>(
  events: AgentEvent[],
  type: TType,
): Extract<AgentEvent, { type: TType }> {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event && isEventType(event, type)) {
      return event;
    }
  }

  throw new Error(`Expected a ${type} event`);
}

/** Built-in tool definitions for tests. */
function builtinToolDefs(): Tool[] {
  return [shellTool, editTool, todoWriteTool, todoReadTool];
}

/** Built-in tool handlers for tests. */
function builtinToolHandlers(
  messages: Message[] = [],
): Map<string, ToolHandler> {
  return new Map<string, ToolHandler>([
    [
      "shell",
      async (args, cwd, signal, onUpdate) =>
        executeShell({ command: args.command as string }, cwd, {
          ...(signal ? { signal } : {}),
          ...(onUpdate ? { onUpdate } : {}),
        }),
    ],
    [
      "edit",
      (args, cwd) =>
        executeEdit(
          {
            path: args.path as string,
            oldText: args.oldText as string,
            newText: args.newText as string,
          },
          cwd,
        ),
    ],
    [
      "todoWrite",
      (args) =>
        executeTodoWrite(
          {
            todos: args.todos as Array<{
              content: string;
              status: "pending" | "in_progress" | "completed" | "cancelled";
            }>,
          },
          messages,
        ),
    ],
    ["todoRead", () => executeTodoRead(messages)],
  ]);
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
      toolHandlers: new Map(),
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
      toolHandlers: new Map(),
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
      tools: builtinToolDefs(),
      toolHandlers: builtinToolHandlers(),
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
      tools: builtinToolDefs(),
      toolHandlers: builtinToolHandlers(),
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
      tools: builtinToolDefs(),
      toolHandlers: builtinToolHandlers(),
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
      tools: builtinToolDefs(),
      toolHandlers: builtinToolHandlers(),
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

  test("consumes queued steering messages one at a time after stop responses in FIFO turn order", async () => {
    faux.setResponses([
      fauxAssistantMessage("First response."),
      fauxAssistantMessage("Second response."),
      fauxAssistantMessage("Third response."),
    ]);

    const events: AgentEvent[] = [];
    const session = createSession(db, { cwd: tmp });
    const userMsg = makeUser("initial prompt");
    const turn = appendMessage(db, session.id, userMsg);
    const queuedMessages = [makeUser("steer one"), makeUser("steer two")];

    const result = await runAgentLoop({
      db,
      sessionId: session.id,
      turn,
      model: faux.getModel(),
      systemPrompt: "Test",
      tools: [],
      toolHandlers: new Map(),
      messages: [userMsg],
      cwd: tmp,
      takeQueuedUserMessage: () => queuedMessages.shift() ?? null,
      onEvent: (event) => events.push(event),
    });

    expect(result.stopReason).toBe("stop");
    expect(result.messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "user",
      "assistant",
      "user",
      "assistant",
    ]);
    expect(result.messages[2]).toMatchObject({
      role: "user",
      content: "steer one",
    });
    expect(result.messages[4]).toMatchObject({
      role: "user",
      content: "steer two",
    });

    const dbTurns = db
      .query<{ turn: number | null }, [string]>(
        "SELECT turn FROM messages WHERE session_id = ? ORDER BY id",
      )
      .all(session.id)
      .map((row) => row.turn);
    expect(dbTurns).toEqual([1, 1, 2, 2, 3, 3]);

    const queuedUserEvents = events.filter(
      (event) => event.type === "user_message",
    );
    expect(queuedUserEvents).toHaveLength(2);
    expect(queuedUserEvents[0]).toMatchObject({
      type: "user_message",
      message: { role: "user", content: "steer one" },
    });
    expect(queuedUserEvents[1]).toMatchObject({
      type: "user_message",
      message: { role: "user", content: "steer two" },
    });
  });

  test("consumes a queued steering message after tool results and starts a new turn", async () => {
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall("shell", { command: "echo hi" })], {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage("Handled steering."),
    ]);

    const session = createSession(db, { cwd: tmp });
    const userMsg = makeUser("initial prompt");
    const turn = appendMessage(db, session.id, userMsg);
    const queuedMessages = [makeUser("steer after tool")];

    const result = await runAgentLoop({
      db,
      sessionId: session.id,
      turn,
      model: faux.getModel(),
      systemPrompt: "Test",
      tools: builtinToolDefs(),
      toolHandlers: builtinToolHandlers(),
      messages: [userMsg],
      cwd: tmp,
      takeQueuedUserMessage: () => queuedMessages.shift() ?? null,
    });

    expect(result.stopReason).toBe("stop");
    expect(result.messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "toolResult",
      "user",
      "assistant",
    ]);
    expect(result.messages[3]).toMatchObject({
      role: "user",
      content: "steer after tool",
    });

    const dbTurns = db
      .query<{ turn: number | null }, [string]>(
        "SELECT turn FROM messages WHERE session_id = ? ORDER BY id",
      )
      .all(session.id)
      .map((row) => row.turn);
    expect(dbTurns).toEqual([1, 1, 1, 2, 2]);
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
      toolHandlers: new Map(),
      messages: [userMsg],
      cwd: tmp,
      onEvent: (e) => events.push(e),
    });

    const textDeltas = events.filter((event) => event.type === "text_delta");
    expect(textDeltas.length).toBeGreaterThan(0);
    const lastTextDelta = expectLastEvent(events, "text_delta");
    expect(lastTextDelta.content).toEqual([fauxText("Hello world")]);

    const doneEvents = events.filter((e) => e.type === "done");
    expect(doneEvents).toHaveLength(1);
  });

  test("emits thinking delta events during streaming", async () => {
    faux.setResponses([
      fauxAssistantMessage([
        fauxThinking("Need to inspect the failing test."),
        fauxText("Done."),
      ]),
    ]);

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
      toolHandlers: new Map(),
      messages: [userMsg],
      cwd: tmp,
      onEvent: (e) => events.push(e),
    });

    const thinkingDeltas = events.filter(
      (event) => event.type === "thinking_delta",
    );
    expect(thinkingDeltas.length).toBeGreaterThan(0);
    const lastThinkingDelta = expectLastEvent(events, "thinking_delta");
    expect(lastThinkingDelta.content).toEqual([
      fauxThinking("Need to inspect the failing test."),
    ]);
  });

  test("emits streamed tool-call construction events before execution starts", async () => {
    const api = "toolcall-stream-test";
    const sourceId = "toolcall-stream-test-source";
    const model: Model<string> = {
      id: "toolcall-stream-model",
      name: "Tool Call Stream Model",
      api,
      provider: "test",
      baseUrl: "http://localhost:0",
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128000,
      maxTokens: 4096,
    };

    let callCount = 0;
    const finalToolCall = fauxToolCall(
      "shell",
      { command: "echo streamed-tool" },
      { id: "tool-1" },
    );
    const buildProviderStream = () => {
      callCount += 1;
      const stream = createAssistantMessageEventStream();

      if (callCount === 1) {
        const finalMessage: AssistantMessage = {
          role: "assistant",
          content: [finalToolCall],
          api,
          provider: model.provider,
          model: model.id,
          usage: ZERO_USAGE,
          stopReason: "toolUse",
          timestamp: Date.now(),
        };
        const partialStart: AssistantMessage = {
          ...finalMessage,
          content: [fauxToolCall("shell", {}, { id: "tool-1" })],
        };
        const partialDelta: AssistantMessage = {
          ...finalMessage,
          content: [
            fauxToolCall(
              "shell",
              { command: "echo streamed" },
              { id: "tool-1" },
            ),
          ],
        };

        queueMicrotask(() => {
          stream.push({
            type: "toolcall_start",
            contentIndex: 0,
            partial: partialStart,
          });
          stream.push({
            type: "toolcall_delta",
            contentIndex: 0,
            delta: '{"command":"echo streamed"}',
            partial: partialDelta,
          });
          stream.push({
            type: "toolcall_end",
            contentIndex: 0,
            toolCall: finalToolCall,
            partial: finalMessage,
          });
          stream.push({
            type: "done",
            reason: "toolUse",
            message: finalMessage,
          });
          stream.end(finalMessage);
        });

        return stream;
      }

      const finalMessage = fauxAssistantMessage("Done.");
      queueMicrotask(() => {
        stream.push({
          type: "done",
          reason: "stop",
          message: finalMessage,
        });
        stream.end(finalMessage);
      });

      return stream;
    };

    registerApiProvider(
      {
        api,
        stream: (_model, _context, _options) => buildProviderStream(),
        streamSimple: (_model, _context, _options) => buildProviderStream(),
      },
      sourceId,
    );

    try {
      const events: AgentEvent[] = [];
      const session = createSession(db, { cwd: tmp });
      const userMsg = makeUser("hi");
      const turn = appendMessage(db, session.id, userMsg);

      await runAgentLoop({
        db,
        sessionId: session.id,
        turn,
        model,
        systemPrompt: "Test",
        tools: [shellTool],
        toolHandlers: new Map<string, ToolHandler>([
          [
            "shell",
            () => ({
              content: [{ type: "text", text: "tool output" }],
              isError: false,
            }),
          ],
        ]),
        messages: [userMsg],
        cwd: tmp,
        onEvent: (event) => events.push(event),
      });

      const toolCallStart = expectEvent(events, "toolcall_start");
      const toolCallDelta = expectEvent(events, "toolcall_delta");
      const toolCallEnd = expectEvent(events, "toolcall_end");
      const assistantMessage = expectEvent(events, "assistant_message");
      const toolStart = expectEvent(events, "tool_start");

      expect(toolCallStart.toolCallId).toBe("tool-1");
      expect(toolCallStart.name).toBe("shell");
      expect(toolCallStart.args).toEqual({});
      expect(toolCallDelta.args).toEqual({ command: "echo streamed" });
      expect(toolCallEnd.args).toEqual({ command: "echo streamed-tool" });
      expect(toolCallEnd.content).toEqual([finalToolCall]);
      expect(assistantMessage.message.stopReason).toBe("toolUse");
      expect(toolStart.args).toEqual({ command: "echo streamed-tool" });

      const toolCallStartIndex = events.indexOf(toolCallStart);
      const toolCallDeltaIndex = events.indexOf(toolCallDelta);
      const toolCallEndIndex = events.indexOf(toolCallEnd);
      const assistantMessageIndex = events.indexOf(assistantMessage);
      const toolStartIndex = events.indexOf(toolStart);

      expect(toolCallStartIndex).toBeLessThan(toolCallDeltaIndex);
      expect(toolCallDeltaIndex).toBeLessThan(toolCallEndIndex);
      expect(toolCallEndIndex).toBeLessThan(assistantMessageIndex);
      expect(assistantMessageIndex).toBeLessThan(toolStartIndex);
    } finally {
      unregisterApiProviders(sourceId);
    }
  });

  test("reconstructs thinking content when the final done message omits it", async () => {
    const api = "reasoning-drop-test";
    const sourceId = "reasoning-drop-test-source";
    const model: Model<string> = {
      id: "reasoning-drop-model",
      name: "Reasoning Drop Model",
      api,
      provider: "test",
      baseUrl: "http://localhost:0",
      reasoning: true,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128000,
      maxTokens: 4096,
    };

    registerApiProvider(
      {
        api,
        stream: (_model, _context, _options) => {
          const stream = createAssistantMessageEventStream();
          const partial: AssistantMessage = {
            role: "assistant",
            content: [
              fauxThinking("Need to inspect the failing test."),
              fauxText("Done."),
            ],
            api,
            provider: "test",
            model: model.id,
            usage: ZERO_USAGE,
            stopReason: "stop",
            timestamp: Date.now(),
          };
          const finalMessage: AssistantMessage = {
            ...partial,
            content: [fauxText("Done.")],
          };

          queueMicrotask(() => {
            stream.push({
              type: "thinking_delta",
              contentIndex: 0,
              delta: "Need to inspect the failing test.",
              partial,
            });
            stream.push({
              type: "text_delta",
              contentIndex: 1,
              delta: "Done.",
              partial,
            });
            stream.push({
              type: "done",
              reason: "stop",
              message: finalMessage,
            });
            stream.end(finalMessage);
          });

          return stream;
        },
        streamSimple: (_model, _context, _options) => {
          const stream = createAssistantMessageEventStream();
          const partial: AssistantMessage = {
            role: "assistant",
            content: [
              fauxThinking("Need to inspect the failing test."),
              fauxText("Done."),
            ],
            api,
            provider: "test",
            model: model.id,
            usage: ZERO_USAGE,
            stopReason: "stop",
            timestamp: Date.now(),
          };
          const finalMessage: AssistantMessage = {
            ...partial,
            content: [fauxText("Done.")],
          };

          queueMicrotask(() => {
            stream.push({
              type: "thinking_delta",
              contentIndex: 0,
              delta: "Need to inspect the failing test.",
              partial,
            });
            stream.push({
              type: "text_delta",
              contentIndex: 1,
              delta: "Done.",
              partial,
            });
            stream.push({
              type: "done",
              reason: "stop",
              message: finalMessage,
            });
            stream.end(finalMessage);
          });

          return stream;
        },
      },
      sourceId,
    );

    try {
      const session = createSession(db, { cwd: tmp });
      const userMsg = makeUser("hi");
      const turn = appendMessage(db, session.id, userMsg);

      const result = await runAgentLoop({
        db,
        sessionId: session.id,
        turn,
        model,
        systemPrompt: "Test",
        tools: [],
        toolHandlers: new Map(),
        messages: [userMsg],
        cwd: tmp,
      });

      const assistant = result.messages[1];
      expect(assistant?.role).toBe("assistant");
      if (assistant?.role !== "assistant") {
        throw new Error("Expected assistant message");
      }
      expect(assistant.content).toContainEqual(
        fauxThinking("Need to inspect the failing test."),
      );
      expect(assistant.content).toContainEqual(fauxText("Done."));
    } finally {
      unregisterApiProviders(sourceId);
    }
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
      tools: builtinToolDefs(),
      toolHandlers: builtinToolHandlers(),
      messages: [userMsg],
      cwd: tmp,
      onEvent: (e) => events.push(e),
    });

    const toolStarts = events.filter((e) => e.type === "tool_start");
    const toolEnds = events.filter((e) => e.type === "tool_end");
    expect(toolStarts).toHaveLength(1);
    expect(toolEnds).toHaveLength(1);
  });

  test("emits committed assistant and tool-result events in tool-use order", async () => {
    faux.setResponses([
      fauxAssistantMessage(
        [
          fauxText("I'll inspect the output first."),
          fauxToolCall("shell", { command: "echo test" }),
        ],
        { stopReason: "toolUse" },
      ),
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
      tools: builtinToolDefs(),
      toolHandlers: builtinToolHandlers(),
      messages: [userMsg],
      cwd: tmp,
      onEvent: (e) => events.push(e),
    });

    const assistantMessages = events.filter(
      (event) => event.type === "assistant_message",
    );
    const toolResults = events.filter((event) => event.type === "tool_result");

    expect(assistantMessages).toHaveLength(2);
    expect(toolResults).toHaveLength(1);

    const firstAssistant = assistantMessages[0];
    const toolStart = events.find((event) => event.type === "tool_start");
    const toolEnd = events.find((event) => event.type === "tool_end");
    const toolResult = toolResults[0];

    if (
      !firstAssistant ||
      firstAssistant.type !== "assistant_message" ||
      !toolStart ||
      toolStart.type !== "tool_start" ||
      !toolEnd ||
      toolEnd.type !== "tool_end" ||
      !toolResult ||
      toolResult.type !== "tool_result"
    ) {
      throw new Error(
        "Expected assistant, tool start/end, and tool result events",
      );
    }

    expect(firstAssistant.message.stopReason).toBe("toolUse");
    expect(firstAssistant.message.content).toContainEqual(
      fauxText("I'll inspect the output first."),
    );

    const firstAssistantIndex = events.indexOf(firstAssistant);
    const toolStartIndex = events.indexOf(toolStart);
    const toolEndIndex = events.indexOf(toolEnd);
    const toolResultIndex = events.indexOf(toolResult);

    expect(firstAssistantIndex).toBeLessThan(toolStartIndex);
    expect(toolEndIndex).toBeLessThan(toolResultIndex);
  });

  test("emits tool delta events during tool execution", async () => {
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall("shell", { command: "echo test" })], {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage("Done."),
    ]);

    const events: AgentEvent[] = [];
    const toolHandlers = new Map<string, ToolHandler>([
      [
        "shell",
        async (_args, _cwd, _signal, onUpdate) => {
          onUpdate?.({
            content: [{ type: "text", text: "partial output" }],
            isError: false,
          });
          return {
            content: [{ type: "text", text: "final output" }],
            isError: false,
          };
        },
      ],
    ]);

    const session = createSession(db, { cwd: tmp });
    const userMsg = makeUser("go");
    const turn = appendMessage(db, session.id, userMsg);

    await runAgentLoop({
      db,
      sessionId: session.id,
      turn,
      model: faux.getModel(),
      systemPrompt: "Test",
      tools: builtinToolDefs(),
      toolHandlers,
      messages: [userMsg],
      cwd: tmp,
      onEvent: (e) => events.push(e),
    });

    const toolStart = expectEvent(events, "tool_start");
    const toolDelta = expectEvent(events, "tool_delta");
    const toolEnd = expectEvent(events, "tool_end");

    expect(toolDelta.toolCallId).toBe(toolStart.toolCallId);
    expect(toolEnd.toolCallId).toBe(toolStart.toolCallId);
    expect(toolDelta.result.content).toEqual([
      { type: "text", text: "partial output" },
    ]);
    expect(toolEnd.result.content).toEqual([
      { type: "text", text: "final output" },
    ]);

    const startIndex = events.findIndex((event) => event.type === "tool_start");
    const deltaIndex = events.findIndex((event) => event.type === "tool_delta");
    const endIndex = events.findIndex((event) => event.type === "tool_end");
    expect(startIndex).toBeLessThan(deltaIndex);
    expect(deltaIndex).toBeLessThan(endIndex);
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
      toolHandlers: new Map(),
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

  test("interrupt during tool execution ends the turn without re-entering the model loop", async () => {
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall("shell", { command: "sleep 10" })], {
        stopReason: "toolUse",
      }),
    ]);

    const controller = new AbortController();
    const events: AgentEvent[] = [];
    const toolHandlers = new Map<string, ToolHandler>([
      [
        "shell",
        async () => {
          controller.abort();
          return {
            content: [
              {
                type: "text",
                text: "Shell error: This operation was aborted",
              },
            ],
            isError: true,
          };
        },
      ],
    ]);

    const session = createSession(db, { cwd: tmp });
    const userMsg = makeUser("run and interrupt");
    const turn = appendMessage(db, session.id, userMsg);

    const result = await runAgentLoop({
      db,
      sessionId: session.id,
      turn,
      model: faux.getModel(),
      systemPrompt: "Test",
      tools: builtinToolDefs(),
      toolHandlers,
      messages: [userMsg],
      cwd: tmp,
      signal: controller.signal,
      onEvent: (event) => events.push(event),
    });

    expect(result.stopReason).toBe("aborted");
    expect(result.messages).toHaveLength(3);
    expect(result.messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "toolResult",
    ]);

    const toolResult = result.messages[2];
    expect(toolResult?.role).toBe("toolResult");
    if (!toolResult || toolResult.role !== "toolResult") {
      throw new Error("Expected tool result message");
    }
    expect(toolResult.isError).toBe(true);
    expect(toolResult.content).toEqual([
      { type: "text", text: "Shell error: This operation was aborted" },
    ]);

    const abortedEvent = expectLastEvent(events, "aborted");
    expect(abortedEvent.message.stopReason).toBe("aborted");
    expect(
      events.filter((event) => event.type === "assistant_message"),
    ).toHaveLength(1);
    expect(events.filter((event) => event.type === "tool_result")).toHaveLength(
      1,
    );

    const dbMessages = loadMessages(db, session.id);
    expect(dbMessages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "toolResult",
    ]);
  });

  test("interrupt before a non-signal-aware tool runs leaves the file unchanged", async () => {
    faux.setResponses([
      fauxAssistantMessage(
        [
          fauxToolCall("edit", {
            path: "note.txt",
            oldText: "before",
            newText: "after",
          }),
        ],
        { stopReason: "toolUse" },
      ),
    ]);
    writeFileSync(join(tmp, "note.txt"), "before", "utf-8");

    const controller = new AbortController();
    const events: AgentEvent[] = [];
    const toolPath = join(tmp, "note.txt");

    const session = createSession(db, { cwd: tmp });
    const userMsg = makeUser("abort before edit");
    const turn = appendMessage(db, session.id, userMsg);

    const result = await runAgentLoop({
      db,
      sessionId: session.id,
      turn,
      model: faux.getModel(),
      systemPrompt: "Test",
      tools: builtinToolDefs(),
      toolHandlers: builtinToolHandlers(),
      messages: [userMsg],
      cwd: tmp,
      signal: controller.signal,
      onEvent: (event) => {
        events.push(event);
        if (event.type === "tool_start") {
          controller.abort();
        }
      },
    });

    expect(result.stopReason).toBe("aborted");
    expect(readFileSync(toolPath, "utf-8")).toBe("before");

    const toolResult = result.messages[2];
    expect(toolResult?.role).toBe("toolResult");
    if (!toolResult || toolResult.role !== "toolResult") {
      throw new Error("Expected tool result message");
    }
    expect(toolResult.isError).toBe(true);
    expect(toolResult.content).toEqual([
      { type: "text", text: "Tool edit failed: This operation was aborted" },
    ]);

    const startIndex = events.findIndex((event) => event.type === "tool_start");
    const endIndex = events.findIndex((event) => event.type === "tool_end");
    const resultIndex = events.findIndex(
      (event) => event.type === "tool_result",
    );
    const abortedIndex = events.findIndex((event) => event.type === "aborted");
    expect(startIndex).toBeGreaterThan(-1);
    expect(startIndex).toBeLessThan(endIndex);
    expect(endIndex).toBeLessThan(resultIndex);
    expect(resultIndex).toBeLessThan(abortedIndex);
  });

  test("uses an explicit stream end result when no terminal event was emitted", async () => {
    const api = "agent-stream-end-result-test";
    const sourceId = "agent-stream-end-result-test-source";
    const model: Model<string> = {
      id: "agent-stream-end-result-model",
      name: "Agent Stream End Result Model",
      api,
      provider: "test",
      baseUrl: "http://localhost:0",
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128000,
      maxTokens: 4096,
    };

    const finalMessage: AssistantMessage = {
      role: "assistant",
      content: [{ type: "text", text: "done without terminal event" }],
      api,
      provider: model.provider,
      model: model.id,
      usage: ZERO_USAGE,
      stopReason: "stop",
      timestamp: Date.now(),
    };

    registerApiProvider(
      {
        api,
        stream: () => {
          const stream = createAssistantMessageEventStream();
          queueMicrotask(() => {
            stream.end(finalMessage);
          });
          return stream;
        },
        streamSimple: () => {
          const stream = createAssistantMessageEventStream();
          queueMicrotask(() => {
            stream.end(finalMessage);
          });
          return stream;
        },
      },
      sourceId,
    );

    const session = createSession(db, { cwd: tmp });
    const userMsg = makeUser("hello");
    const turn = appendMessage(db, session.id, userMsg);

    try {
      const result = await runAgentLoop({
        db,
        sessionId: session.id,
        turn,
        model,
        systemPrompt: "Test",
        tools: [],
        toolHandlers: new Map(),
        messages: [userMsg],
        cwd: tmp,
      });

      expect(result.stopReason).toBe("stop");
      const lastMessage = result.messages.at(-1);
      expect(lastMessage?.role).toBe("assistant");
      if (!lastMessage || lastMessage.role !== "assistant") {
        throw new Error("Expected assistant message");
      }
      expect(lastMessage.stopReason).toBe("stop");
      expect(lastMessage.content).toEqual(finalMessage.content);
    } finally {
      unregisterApiProviders(sourceId);
    }
  });

  test("treats a stream that ends without a terminal event as an error instead of hanging", async () => {
    const api = "agent-incomplete-stream-test";
    const sourceId = "agent-incomplete-stream-test-source";
    const model: Model<string> = {
      id: "agent-incomplete-stream-model",
      name: "Agent Incomplete Stream Model",
      api,
      provider: "test",
      baseUrl: "http://localhost:0",
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128000,
      maxTokens: 4096,
    };

    const buildPartialMessage = (): AssistantMessage => ({
      role: "assistant",
      content: [{ type: "text", text: "partial" }],
      api,
      provider: model.provider,
      model: model.id,
      usage: ZERO_USAGE,
      stopReason: "stop",
      timestamp: Date.now(),
    });

    registerApiProvider(
      {
        api,
        stream: () => {
          const stream = createAssistantMessageEventStream();
          queueMicrotask(() => {
            stream.push({
              type: "start",
              partial: buildPartialMessage(),
            });
            stream.end();
          });
          return stream;
        },
        streamSimple: () => {
          const stream = createAssistantMessageEventStream();
          queueMicrotask(() => {
            stream.push({
              type: "start",
              partial: buildPartialMessage(),
            });
            stream.end();
          });
          return stream;
        },
      },
      sourceId,
    );

    const session = createSession(db, { cwd: tmp });
    const userMsg = makeUser("hello");
    const turn = appendMessage(db, session.id, userMsg);
    const timeout = Symbol("timeout");

    try {
      const raced = await Promise.race([
        runAgentLoop({
          db,
          sessionId: session.id,
          turn,
          model,
          systemPrompt: "Test",
          tools: [],
          toolHandlers: new Map(),
          messages: [userMsg],
          cwd: tmp,
        }),
        new Promise<typeof timeout>((resolve) => {
          setTimeout(() => resolve(timeout), 100);
        }),
      ]);

      expect(raced).not.toBe(timeout);
      if (raced === timeout) {
        throw new Error("Expected runAgentLoop to settle");
      }

      expect(raced.stopReason).toBe("error");
      const lastMessage = raced.messages.at(-1);
      expect(lastMessage?.role).toBe("assistant");
      if (!lastMessage || lastMessage.role !== "assistant") {
        throw new Error("Expected assistant error message");
      }
      expect(lastMessage.stopReason).toBe("error");
      expect(lastMessage.errorMessage).toContain(
        "Stream ended without a final assistant message",
      );
    } finally {
      unregisterApiProviders(sourceId);
    }
  });

  test("preserves thinking content on assistant messages", async () => {
    faux.setResponses([
      fauxAssistantMessage([
        fauxThinking("Need to inspect the failing test."),
        fauxText("Done."),
      ]),
    ]);

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
      toolHandlers: new Map(),
      messages: [userMsg],
      cwd: tmp,
    });

    const assistant = result.messages[1];
    expect(assistant?.role).toBe("assistant");
    if (assistant?.role !== "assistant") {
      throw new Error("Expected assistant message");
    }
    expect(assistant.content).toContainEqual(
      fauxThinking("Need to inspect the failing test."),
    );
    expect(assistant.content).toContainEqual(fauxText("Done."));
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
      toolHandlers: new Map(),
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
      tools: builtinToolDefs(),
      toolHandlers: builtinToolHandlers(),
      messages: [userMsg],
      cwd: tmp,
    });

    // Should still complete — the error tool result lets the model self-correct
    expect(result.messages.length).toBeGreaterThanOrEqual(4);
    // The tool result should be an error
    const toolResult = result.messages.find(
      (message) => message.role === "toolResult",
    );
    if (!toolResult || toolResult.role !== "toolResult") {
      throw new Error("Expected tool result message");
    }
    expect(toolResult.isError).toBe(true);
  });

  test("converts thrown tool handler errors into error tool results", async () => {
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall("shell", { command: "explode" })], {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage("Recovered after tool failure."),
    ]);

    const events: AgentEvent[] = [];
    const toolHandlers = new Map<string, ToolHandler>([
      [
        "shell",
        () => {
          throw new Error("kaboom");
        },
      ],
    ]);

    const session = createSession(db, { cwd: tmp });
    const userMsg = makeUser("run the failing tool");
    const turn = appendMessage(db, session.id, userMsg);

    const result = await runAgentLoop({
      db,
      sessionId: session.id,
      turn,
      model: faux.getModel(),
      systemPrompt: "Test",
      tools: builtinToolDefs(),
      toolHandlers,
      messages: [userMsg],
      cwd: tmp,
      onEvent: (event) => events.push(event),
    });

    expect(result.stopReason).toBe("stop");
    expect(result.messages).toHaveLength(4);

    const toolResult = result.messages.find(
      (message) => message.role === "toolResult",
    );
    if (!toolResult || toolResult.role !== "toolResult") {
      throw new Error("Expected tool result message");
    }
    expect(toolResult.isError).toBe(true);
    expect(toolResult.content).toEqual([
      { type: "text", text: "Tool shell failed: kaboom" },
    ]);

    const toolStart = expectEvent(events, "tool_start");
    const toolEnd = expectEvent(events, "tool_end");
    const toolResultEvent = expectEvent(events, "tool_result");

    expect(toolEnd.result.isError).toBe(true);
    expect(toolEnd.result.content).toEqual([
      { type: "text", text: "Tool shell failed: kaboom" },
    ]);
    expect(events.indexOf(toolStart)).toBeLessThan(events.indexOf(toolEnd));
    expect(events.indexOf(toolEnd)).toBeLessThan(
      events.indexOf(toolResultEvent),
    );
  });

  test("injects a todo reminder and re-prompts when pending todos remain", async () => {
    faux.setResponses([
      fauxAssistantMessage("All done."),
      fauxAssistantMessage("I still need to finish the pending work."),
    ]);

    const session = createSession(db, { cwd: tmp });
    const userMsg = makeUser("finish the task");
    const turn = appendMessage(db, session.id, userMsg);
    const messages: Message[] = [
      makeTodoSnapshotMessage([
        { content: "Run the test suite", status: "pending" },
        { content: "Summarize the verified changes", status: "in_progress" },
      ]),
      userMsg,
    ];

    const result = await runAgentLoop({
      db,
      sessionId: session.id,
      turn,
      model: faux.getModel(),
      systemPrompt: "Test",
      tools: builtinToolDefs(),
      toolHandlers: builtinToolHandlers(messages),
      messages,
      cwd: tmp,
    });

    expect(result.stopReason).toBe("stop");
    expect(
      result.messages.filter((message) => message.role === "assistant"),
    ).toHaveLength(2);
    const lastMessage = result.messages.at(-1);
    if (!lastMessage || lastMessage.role !== "assistant") {
      throw new Error("Expected a final assistant message");
    }
    expect(lastMessage.content).toEqual([
      { type: "text", text: "I still need to finish the pending work." },
    ]);
  });

  test("wraps injected todo reminders in a system_reminder block", async () => {
    const api = "todo-reminder-tag-test";
    const sourceId = "todo-reminder-tag-test-source";
    const model: Model<string> = {
      id: "todo-reminder-tag-model",
      name: "Todo Reminder Tag Model",
      api,
      provider: "test",
      baseUrl: "http://localhost:0",
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128000,
      maxTokens: 4096,
    };
    const requestMessages: Message[][] = [];
    let callCount = 0;

    const buildProviderStream = (context: Context) => {
      requestMessages.push(structuredClone(context.messages));
      const stream = createAssistantMessageEventStream();
      const finalMessage = fauxAssistantMessage(
        callCount === 0 ? "All done." : "I still need to keep working.",
      );
      callCount += 1;

      queueMicrotask(() => {
        stream.push({
          type: "done",
          reason: "stop",
          message: finalMessage,
        });
        stream.end(finalMessage);
      });

      return stream;
    };

    registerApiProvider(
      {
        api,
        stream: (_model, context) => buildProviderStream(context),
        streamSimple: (_model, context) => buildProviderStream(context),
      },
      sourceId,
    );

    try {
      const session = createSession(db, { cwd: tmp });
      const userMsg = makeUser("finish the task");
      const turn = appendMessage(db, session.id, userMsg);
      const messages: Message[] = [
        makeTodoSnapshotMessage([
          { content: "Run the test suite", status: "pending" },
          { content: "Summarize the verified changes", status: "in_progress" },
        ]),
        userMsg,
      ];

      const result = await runAgentLoop({
        db,
        sessionId: session.id,
        turn,
        model,
        systemPrompt: "Test",
        tools: builtinToolDefs(),
        toolHandlers: builtinToolHandlers(messages),
        messages,
        cwd: tmp,
      });

      expect(result.stopReason).toBe("stop");
      expect(requestMessages).toHaveLength(2);
      const reminder = requestMessages[1]?.at(-1);
      if (!reminder || reminder.role !== "user") {
        throw new Error("Expected the injected reminder to be a user message");
      }
      if (typeof reminder.content !== "string") {
        throw new Error("Expected the injected reminder content to be text");
      }

      expect(reminder.content).toStartWith("<system_reminder>\n");
      expect(reminder.content).toEndWith("\n</system_reminder>");
      expect(reminder.content).toContain(
        "You have pending todo items that must be completed before finishing the task:",
      );
      expect(reminder.content).toContain("- [PENDING] Run the test suite");
      expect(reminder.content).toContain(
        "- [IN_PROGRESS] Summarize the verified changes",
      );
    } finally {
      unregisterApiProviders(sourceId);
    }
  });

  test("does not inject duplicate todo reminders for the same pending set", async () => {
    faux.setResponses([
      fauxAssistantMessage("All done."),
      fauxAssistantMessage("All done again."),
    ]);

    const session = createSession(db, { cwd: tmp });
    const userMsg = makeUser("finish the task");
    const turn = appendMessage(db, session.id, userMsg);
    const messages: Message[] = [
      makeTodoSnapshotMessage([
        { content: "Run the test suite", status: "pending" },
      ]),
      userMsg,
    ];

    const result = await runAgentLoop({
      db,
      sessionId: session.id,
      turn,
      model: faux.getModel(),
      systemPrompt: "Test",
      tools: builtinToolDefs(),
      toolHandlers: builtinToolHandlers(messages),
      messages,
      cwd: tmp,
    });

    expect(result.stopReason).toBe("stop");
    expect(
      result.messages.filter((message) => message.role === "assistant"),
    ).toHaveLength(2);
    const lastMessage = result.messages.at(-1);
    if (!lastMessage || lastMessage.role !== "assistant") {
      throw new Error("Expected a final assistant message");
    }
    expect(lastMessage.content).toEqual([
      { type: "text", text: "All done again." },
    ]);
  });

  test("does not re-inject the same todo reminder after a queued steering message starts a new turn", async () => {
    faux.setResponses([
      fauxAssistantMessage("All done."),
      fauxAssistantMessage("Still done."),
      fauxAssistantMessage("Handled steering without a duplicate reminder."),
      fauxAssistantMessage("Duplicate reminder fired."),
    ]);

    const session = createSession(db, { cwd: tmp });
    const userMsg = makeUser("finish the task");
    const turn = appendMessage(db, session.id, userMsg);
    const messages: Message[] = [
      makeTodoSnapshotMessage([
        { content: "Run the test suite", status: "pending" },
      ]),
      userMsg,
    ];
    let dequeueCallCount = 0;

    const result = await runAgentLoop({
      db,
      sessionId: session.id,
      turn,
      model: faux.getModel(),
      systemPrompt: "Test",
      tools: builtinToolDefs(),
      toolHandlers: builtinToolHandlers(messages),
      messages,
      cwd: tmp,
      takeQueuedUserMessage: () => {
        dequeueCallCount += 1;
        return dequeueCallCount === 2 ? makeUser("steer once") : null;
      },
    });

    expect(result.stopReason).toBe("stop");
    const assistantMessages = result.messages.filter(
      (message): message is AssistantMessage => message.role === "assistant",
    );
    expect(assistantMessages).toHaveLength(3);
    expect(assistantMessages.at(-1)?.content).toEqual([
      {
        type: "text",
        text: "Handled steering without a duplicate reminder.",
      },
    ]);
  });

  test("does not re-inject the same todo reminder when the incomplete set is only reordered", async () => {
    faux.setResponses([
      fauxAssistantMessage("All done."),
      fauxAssistantMessage(
        [
          fauxToolCall("todoWrite", {
            todos: [
              {
                content: "Summarize the verified changes",
                status: "in_progress",
              },
              { content: "Run the test suite", status: "pending" },
            ],
          }),
        ],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage(
        "Handled reordered todos without a duplicate reminder.",
      ),
      fauxAssistantMessage("Duplicate reminder fired."),
    ]);

    const session = createSession(db, { cwd: tmp });
    const userMsg = makeUser("finish the task");
    const turn = appendMessage(db, session.id, userMsg);
    const messages: Message[] = [
      makeTodoSnapshotMessage([
        { content: "Run the test suite", status: "pending" },
        { content: "Summarize the verified changes", status: "in_progress" },
      ]),
      userMsg,
    ];
    const reorderedTodoWriteHandler: ToolHandler = () => {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              todos: [
                {
                  content: "Summarize the verified changes",
                  status: "in_progress",
                },
                { content: "Run the test suite", status: "pending" },
              ],
            }),
          },
        ],
        isError: false,
      };
    };

    const result = await runAgentLoop({
      db,
      sessionId: session.id,
      turn,
      model: faux.getModel(),
      systemPrompt: "Test",
      tools: [todoWriteTool],
      toolHandlers: new Map([[todoWriteTool.name, reorderedTodoWriteHandler]]),
      messages,
      cwd: tmp,
    });

    expect(result.stopReason).toBe("stop");
    const assistantMessages = result.messages.filter(
      (message): message is AssistantMessage => message.role === "assistant",
    );
    expect(assistantMessages).toHaveLength(3);
    expect(assistantMessages.at(-1)?.content).toEqual([
      {
        type: "text",
        text: "Handled reordered todos without a duplicate reminder.",
      },
    ]);
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
      toolHandlers: new Map(),
      messages: [userMsg],
      cwd: tmp,
    });

    expect(result.stopReason).toBe("length");
    expect(result.messages).toHaveLength(2);
  });
});
