import { describe, expect, test } from "bun:test";
import type {
  AssistantMessage,
  Message,
  ToolResultMessage,
  UserMessage,
} from "@mariozechner/pi-ai";
import {
  appendMessage,
  computeStats,
  createSession,
  deleteSession,
  forkSession,
  getSession,
  listSessions,
  loadMessages,
  openDatabase,
  undoLastTurn,
} from "./session.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeUser(text: string): UserMessage {
  return { role: "user", content: text, timestamp: Date.now() };
}

function makeAssistant(
  text: string,
  usage?: Partial<AssistantMessage["usage"]>,
): AssistantMessage {
  const defaultUsage: AssistantMessage["usage"] = {
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
  };
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    api: "anthropic-messages",
    provider: "anthropic",
    model: "claude-sonnet-4-20250514",
    usage: { ...defaultUsage, ...usage },
    stopReason: "stop",
    timestamp: Date.now(),
  };
}

function makeToolResult(toolCallId: string, text: string): ToolResultMessage {
  return {
    role: "toolResult",
    toolCallId,
    toolName: "shell",
    content: [{ type: "text", text }],
    isError: false,
    timestamp: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("session persistence", () => {
  test("openDatabase returns a usable database", () => {
    const db = openDatabase(":memory:");
    expect(db).toBeDefined();
    db.close();
  });

  test("createSession inserts a session record", () => {
    const db = openDatabase(":memory:");
    const session = createSession(db, {
      cwd: "/tmp/test",
      model: "anthropic/claude-sonnet-4-20250514",
      effort: "medium",
    });
    expect(session.id).toBeString();
    expect(session.cwd).toBe("/tmp/test");
    expect(session.model).toBe("anthropic/claude-sonnet-4-20250514");
    expect(session.effort).toBe("medium");
    expect(session.forkedFrom).toBeNull();
    expect(session.createdAt).toBeNumber();
    expect(session.updatedAt).toBe(session.createdAt);
    db.close();
  });

  test("getSession retrieves a session by id", () => {
    const db = openDatabase(":memory:");
    const created = createSession(db, { cwd: "/tmp/test" });
    const loaded = getSession(db, created.id);
    expect(loaded).not.toBeNull();
    expect(loaded?.id).toBe(created.id);
    expect(loaded?.cwd).toBe("/tmp/test");
    db.close();
  });

  test("getSession returns null for unknown id", () => {
    const db = openDatabase(":memory:");
    expect(getSession(db, "nonexistent")).toBeNull();
    db.close();
  });

  test("listSessions returns sessions scoped to CWD, ordered by updated_at desc", () => {
    const db = openDatabase(":memory:");
    const s1 = createSession(db, { cwd: "/tmp/a" });
    const s2 = createSession(db, { cwd: "/tmp/a" });
    createSession(db, { cwd: "/tmp/b" }); // different cwd

    // Touch s1 so it becomes more recent
    appendMessage(db, s1.id, makeUser("hello"));

    const list = listSessions(db, "/tmp/a");
    expect(list).toHaveLength(2);
    // s1 was updated more recently (message appended)
    expect(list[0]?.id).toBe(s1.id);
    expect(list[1]?.id).toBe(s2.id);
    db.close();
  });

  test("deleteSession removes session and cascades to messages", () => {
    const db = openDatabase(":memory:");
    const session = createSession(db, { cwd: "/tmp/test" });
    appendMessage(db, session.id, makeUser("hello"));
    deleteSession(db, session.id);
    expect(getSession(db, session.id)).toBeNull();
    expect(loadMessages(db, session.id)).toEqual([]);
    db.close();
  });
});

describe("message persistence and turn numbering", () => {
  test("first user message gets turn 1", () => {
    const db = openDatabase(":memory:");
    const session = createSession(db, { cwd: "/tmp/test" });
    const turn = appendMessage(db, session.id, makeUser("hello"));
    expect(turn).toBe(1);
    db.close();
  });

  test("subsequent messages in same loop share the turn", () => {
    const db = openDatabase(":memory:");
    const session = createSession(db, { cwd: "/tmp/test" });

    const t1 = appendMessage(db, session.id, makeUser("do stuff"));
    expect(t1).toBe(1);

    // Assistant response and tool results share the same turn
    const t2 = appendMessage(db, session.id, makeAssistant("on it"), t1);
    expect(t2).toBe(1);

    const t3 = appendMessage(db, session.id, makeToolResult("tc1", "done"), t1);
    expect(t3).toBe(1);
    db.close();
  });

  test("next user message increments the turn", () => {
    const db = openDatabase(":memory:");
    const session = createSession(db, { cwd: "/tmp/test" });

    const t1 = appendMessage(db, session.id, makeUser("first"));
    appendMessage(db, session.id, makeAssistant("reply"), t1);

    const t2 = appendMessage(db, session.id, makeUser("second"));
    expect(t2).toBe(2);
    db.close();
  });

  test("loadMessages returns all messages in insertion order", () => {
    const db = openDatabase(":memory:");
    const session = createSession(db, { cwd: "/tmp/test" });

    const t1 = appendMessage(db, session.id, makeUser("hello"));
    appendMessage(db, session.id, makeAssistant("hi"), t1);

    const msgs = loadMessages(db, session.id);
    expect(msgs).toHaveLength(2);
    expect(msgs[0]?.role).toBe("user");
    expect(msgs[1]?.role).toBe("assistant");
    db.close();
  });

  test("appendMessage updates session updated_at", () => {
    const db = openDatabase(":memory:");
    const session = createSession(db, { cwd: "/tmp/test" });
    const before = session.updatedAt;

    // Small delay to ensure timestamp differs
    const msg = makeUser("hello");
    msg.timestamp = before + 100;
    appendMessage(db, session.id, msg);

    const updated = getSession(db, session.id);
    expect(updated).not.toBeNull();
    expect(updated?.updatedAt).toBeGreaterThanOrEqual(before);
    db.close();
  });
});

describe("undo", () => {
  test("undoLastTurn removes the highest turn", () => {
    const db = openDatabase(":memory:");
    const session = createSession(db, { cwd: "/tmp/test" });

    const t1 = appendMessage(db, session.id, makeUser("first"));
    appendMessage(db, session.id, makeAssistant("reply1"), t1);

    const t2 = appendMessage(db, session.id, makeUser("second"));
    appendMessage(db, session.id, makeAssistant("reply2"), t2);

    const removed = undoLastTurn(db, session.id);
    expect(removed).toBe(true);

    const msgs = loadMessages(db, session.id);
    expect(msgs).toHaveLength(2);
    expect((msgs[0] as UserMessage).content).toBe("first");
    expect(
      (
        (msgs[1] as AssistantMessage).content[0] as {
          type: "text";
          text: string;
        }
      ).text,
    ).toBe("reply1");
    db.close();
  });

  test("undoLastTurn removes all messages in the turn (user + assistant + tool results)", () => {
    const db = openDatabase(":memory:");
    const session = createSession(db, { cwd: "/tmp/test" });

    const t1 = appendMessage(db, session.id, makeUser("do it"));
    appendMessage(db, session.id, makeAssistant("calling tool"), t1);
    appendMessage(db, session.id, makeToolResult("tc1", "result"), t1);
    appendMessage(db, session.id, makeAssistant("done"), t1);

    const removed = undoLastTurn(db, session.id);
    expect(removed).toBe(true);

    const msgs = loadMessages(db, session.id);
    expect(msgs).toHaveLength(0);
    db.close();
  });

  test("undoLastTurn returns false on empty session", () => {
    const db = openDatabase(":memory:");
    const session = createSession(db, { cwd: "/tmp/test" });
    const removed = undoLastTurn(db, session.id);
    expect(removed).toBe(false);
    db.close();
  });
});

describe("fork", () => {
  test("forkSession copies all messages to a new session", () => {
    const db = openDatabase(":memory:");
    const original = createSession(db, {
      cwd: "/tmp/test",
      model: "m",
      effort: "high",
    });

    const t1 = appendMessage(db, original.id, makeUser("hello"));
    appendMessage(db, original.id, makeAssistant("hi"), t1);

    const forked = forkSession(db, original.id);
    expect(forked.id).not.toBe(original.id);
    expect(forked.cwd).toBe(original.cwd);
    expect(forked.model).toBe(original.model);
    expect(forked.effort).toBe(original.effort);
    expect(forked.forkedFrom).toBe(original.id);

    const forkedMsgs = loadMessages(db, forked.id);
    expect(forkedMsgs).toHaveLength(2);
    expect(forkedMsgs[0]?.role).toBe("user");
    expect(forkedMsgs[1]?.role).toBe("assistant");
    db.close();
  });

  test("fork preserves turn numbers", () => {
    const db = openDatabase(":memory:");
    const original = createSession(db, { cwd: "/tmp/test" });

    const t1 = appendMessage(db, original.id, makeUser("one"));
    appendMessage(db, original.id, makeAssistant("r1"), t1);
    const t2 = appendMessage(db, original.id, makeUser("two"));
    appendMessage(db, original.id, makeAssistant("r2"), t2);

    const forked = forkSession(db, original.id);

    // Appending a new user message to the fork should get turn 3
    const t3 = appendMessage(db, forked.id, makeUser("three"));
    expect(t3).toBe(3);
    db.close();
  });

  test("fork does not affect the original session", () => {
    const db = openDatabase(":memory:");
    const original = createSession(db, { cwd: "/tmp/test" });

    const t1 = appendMessage(db, original.id, makeUser("hello"));
    appendMessage(db, original.id, makeAssistant("hi"), t1);

    const forked = forkSession(db, original.id);
    appendMessage(db, forked.id, makeUser("diverging"));

    const originalMsgs = loadMessages(db, original.id);
    expect(originalMsgs).toHaveLength(2);

    const forkedMsgs = loadMessages(db, forked.id);
    expect(forkedMsgs).toHaveLength(3);
    db.close();
  });
});

describe("cumulative stats", () => {
  test("computeStats sums usage from assistant messages", () => {
    const messages: Message[] = [
      makeUser("hello"),
      makeAssistant("hi", {
        input: 100,
        output: 50,
        totalTokens: 150,
        cost: {
          input: 0.001,
          output: 0.002,
          cacheRead: 0,
          cacheWrite: 0,
          total: 0.003,
        },
      }),
      makeUser("do more"),
      makeAssistant("done", {
        input: 200,
        output: 100,
        totalTokens: 300,
        cost: {
          input: 0.002,
          output: 0.004,
          cacheRead: 0,
          cacheWrite: 0,
          total: 0.006,
        },
      }),
    ];

    const stats = computeStats(messages);
    expect(stats.totalInput).toBe(300);
    expect(stats.totalOutput).toBe(150);
    expect(stats.totalCost).toBeCloseTo(0.009);
  });

  test("computeStats returns zeros for empty history", () => {
    const stats = computeStats([]);
    expect(stats.totalInput).toBe(0);
    expect(stats.totalOutput).toBe(0);
    expect(stats.totalCost).toBe(0);
  });

  test("computeStats ignores non-assistant messages", () => {
    const messages: Message[] = [
      makeUser("hello"),
      makeToolResult("tc1", "result"),
    ];

    const stats = computeStats(messages);
    expect(stats.totalInput).toBe(0);
    expect(stats.totalOutput).toBe(0);
    expect(stats.totalCost).toBe(0);
  });
});
