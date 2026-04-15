import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  AssistantMessage,
  Message,
  ToolResultMessage,
  UserMessage,
} from "@mariozechner/pi-ai";
import {
  addMessageToContextTokens,
  addMessageToStats,
  appendMessage,
  appendPromptHistory,
  computeContextTokens,
  computeStats,
  createSession,
  createUiMessage,
  createUiTodoMessage,
  deleteSession,
  filterModelMessages,
  forkSession,
  getSession,
  listPromptHistory,
  listSessions,
  loadMessages,
  openDatabase,
  truncatePromptHistory,
  truncateSessions,
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

function makeUiMessage(text: string) {
  return createUiMessage(text);
}

function makeUiTodoMessage() {
  return createUiTodoMessage([
    { content: "Review prompt wording", status: "completed" },
    { content: "Implement todo tools", status: "in_progress" },
  ]);
}

function loadSessionOrThrow(db: ReturnType<typeof openDatabase>, id: string) {
  const session = getSession(db, id);
  if (!session) {
    throw new Error(`Expected session ${id} to exist`);
  }
  return session;
}

async function waitForChildStdout(
  stdout: ReadableStream<Uint8Array> | number | null,
  needle: string,
): Promise<void> {
  if (!(stdout instanceof ReadableStream)) {
    throw new Error("Expected child stdout to be piped");
  }

  const reader = stdout.getReader();
  const decoder = new TextDecoder();
  let output = "";

  while (!output.includes(needle)) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    output += decoder.decode(value, { stream: true });
  }

  if (!output.includes(needle)) {
    throw new Error(`Child exited before emitting ${JSON.stringify(needle)}`);
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("session persistence", () => {
  test("createSession inserts a persisted session record with the requested fields", () => {
    const db = openDatabase(":memory:");
    const session = createSession(db, {
      cwd: "/tmp/test",
      model: "anthropic/claude-sonnet-4-20250514",
      effort: "medium",
    });

    const loaded = loadSessionOrThrow(db, session.id);

    expect(session.id.length).toBeGreaterThan(0);
    expect(loaded).toEqual(session);
    expect(loaded.cwd).toBe("/tmp/test");
    expect(loaded.model).toBe("anthropic/claude-sonnet-4-20250514");
    expect(loaded.effort).toBe("medium");
    expect(loaded.forkedFrom).toBeNull();
    expect(loaded.createdAt).toBeGreaterThan(0);
    expect(loaded.updatedAt).toBe(loaded.createdAt);
    db.close();
  });

  test("getSession retrieves the stored session for a known id", () => {
    const db = openDatabase(":memory:");
    const created = createSession(db, { cwd: "/tmp/test" });
    const loaded = loadSessionOrThrow(db, created.id);
    expect(loaded.id).toBe(created.id);
    expect(loaded.cwd).toBe("/tmp/test");
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

    // Explicitly bump s1's updated_at so it sorts first
    db.run("UPDATE sessions SET updated_at = ? WHERE id = ?", [
      Date.now() + 1000,
      s1.id,
    ]);

    const list = listSessions(db, "/tmp/a");
    expect(list).toHaveLength(2);
    // s1 was updated more recently
    expect(list[0]?.id).toBe(s1.id);
    expect(list[1]?.id).toBe(s2.id);
    db.close();
  });

  test("listSessions_firstUserPreview_ignoresLeadingUiMessagesAndUsesTheFirstTurn", () => {
    const db = openDatabase(":memory:");
    const session = createSession(db, {
      cwd: "/tmp/test",
      model: "test/beta",
    });

    appendMessage(db, session.id, makeUiMessage("Help output"));
    const firstTurn = appendMessage(db, session.id, {
      role: "user",
      content: "  first\n\n prompt\tpreview  ",
      timestamp: 1,
    });
    appendMessage(db, session.id, makeAssistant("reply"), firstTurn);
    appendMessage(db, session.id, makeUser("later prompt"));

    const [entry] = listSessions(db, "/tmp/test");

    expect(entry?.firstUserPreview).toBe("first prompt preview");
    db.close();
  });

  test("listSessions_firstUserPreview_returnsNullWhenTheSessionHasNoMessages", () => {
    const db = openDatabase(":memory:");
    createSession(db, { cwd: "/tmp/test" });

    const [entry] = listSessions(db, "/tmp/test");

    expect(entry?.firstUserPreview).toBeNull();
    db.close();
  });

  test("listSessions_firstUserPreview_returnsNullWhenTheFirstMessageRowIsInvalid", () => {
    const db = openDatabase(":memory:");
    const session = createSession(db, { cwd: "/tmp/test" });

    db.run(
      "INSERT INTO messages (session_id, turn, data, created_at) VALUES (?, ?, ?, ?)",
      [session.id, 1, "not json", Date.now()],
    );

    const [entry] = listSessions(db, "/tmp/test");

    expect(entry?.firstUserPreview).toBeNull();
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

describe("database initialization", () => {
  test("openDatabase enables a busy timeout for transient writer contention", () => {
    const db = openDatabase(":memory:");

    const row = db.query<{ timeout: number }, []>("PRAGMA busy_timeout").get();

    expect(row?.timeout).toBeGreaterThan(0);
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

  test("loadMessages round-trips persisted UI messages", () => {
    const db = openDatabase(":memory:");
    const session = createSession(db, { cwd: "/tmp/test" });
    const uiMessage = makeUiMessage("Help output");

    appendMessage(db, session.id, uiMessage);

    const msgs = loadMessages(db, session.id);
    expect(msgs).toEqual([uiMessage]);
    db.close();
  });

  test("loadMessages skips invalid persisted rows and keeps valid messages", () => {
    const db = openDatabase(":memory:");
    const session = createSession(db, { cwd: "/tmp/test" });

    const turn = appendMessage(db, session.id, makeUser("hello"));
    db.run(
      "INSERT INTO messages (session_id, turn, data, created_at) VALUES (?, ?, ?, ?)",
      [session.id, turn, "not json", Date.now()],
    );
    appendMessage(db, session.id, makeAssistant("hi"), turn);

    const msgs = loadMessages(db, session.id);
    expect(msgs).toHaveLength(2);
    expect(msgs[0]?.role).toBe("user");
    expect(msgs[1]?.role).toBe("assistant");
    db.close();
  });

  test("UI messages store turn as NULL and do not consume conversational turn numbers", () => {
    const db = openDatabase(":memory:");
    const session = createSession(db, { cwd: "/tmp/test" });

    const uiTurn = appendMessage(db, session.id, makeUiMessage("Help output"));
    const firstUserTurn = appendMessage(db, session.id, makeUser("hello"));
    const ignoredUiTurn = appendMessage(
      db,
      session.id,
      makeUiMessage("More help"),
      firstUserTurn,
    );
    const secondUserTurn = appendMessage(db, session.id, makeUser("next"));

    const turns = db
      .query<{ turn: number | null }, [string]>(
        "SELECT turn FROM messages WHERE session_id = ? ORDER BY id",
      )
      .all(session.id)
      .map((row) => row.turn);

    expect(uiTurn).toBeNull();
    expect(ignoredUiTurn).toBeNull();
    expect(firstUserTurn).toBe(1);
    expect(secondUserTurn).toBe(2);
    expect(turns).toEqual([null, 1, null, 2]);
    db.close();
  });

  test("appendMessage updates the persisted session timestamp", () => {
    const db = openDatabase(":memory:");
    const session = createSession(db, { cwd: "/tmp/test" });
    const before = session.updatedAt;

    const msg = makeUser("hello");
    msg.timestamp = before + 100;
    appendMessage(db, session.id, msg);

    const updated = loadSessionOrThrow(db, session.id);
    expect(updated.updatedAt).toBeGreaterThanOrEqual(before);
    db.close();
  });

  test("appendMessage when another writer commits first waits and assigns the next turn", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "mini-coder-session-test-"));
    const dbPath = join(tempDir, "session.db");
    const lockScriptPath = join(tempDir, "hold-lock.ts");
    const db = openDatabase(dbPath);
    const session = createSession(db, { cwd: "/tmp/test" });

    writeFileSync(
      lockScriptPath,
      [
        'import { Database } from "bun:sqlite";',
        "const dbPath = process.argv[2];",
        "const sessionId = process.argv[3];",
        'if (!dbPath || !sessionId) throw new Error("missing args");',
        "const db = new Database(dbPath);",
        'db.run("PRAGMA journal_mode = WAL");',
        'db.run("BEGIN IMMEDIATE");',
        "const now = Date.now();",
        'db.run("INSERT INTO messages (session_id, turn, data, created_at) VALUES (?, ?, ?, ?)", [',
        "  sessionId,",
        "  1,",
        '  JSON.stringify({ role: "user", content: "locked", timestamp: now }),',
        "  now,",
        "]);",
        'db.run("UPDATE sessions SET updated_at = ? WHERE id = ?", [now, sessionId]);',
        'console.log("locked");',
        "await Bun.sleep(250);",
        'db.run("COMMIT");',
        "db.close();",
        "",
      ].join("\n"),
      "utf-8",
    );

    const child = Bun.spawn(
      [process.execPath, lockScriptPath, dbPath, session.id],
      {
        stdout: "pipe",
        stderr: "pipe",
      },
    );

    try {
      await waitForChildStdout(child.stdout, "locked");

      const turn = appendMessage(db, session.id, makeUser("after lock"));
      expect(turn).toBe(2);

      const exitCode = await child.exited;
      const stderr = child.stderr
        ? await new Response(child.stderr).text()
        : "";
      expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" });

      const turns = db
        .query<{ turn: number | null }, [string]>(
          "SELECT turn FROM messages WHERE session_id = ? ORDER BY id",
        )
        .all(session.id)
        .map((row) => row.turn);
      expect(turns).toEqual([1, 2]);
    } finally {
      db.close();
      rmSync(tempDir, { recursive: true, force: true });
    }
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

  test("undoLastTurn keeps UI messages because they are not part of conversational turns", () => {
    const db = openDatabase(":memory:");
    const session = createSession(db, { cwd: "/tmp/test" });

    appendMessage(db, session.id, makeUiMessage("Help output"));
    const t1 = appendMessage(db, session.id, makeUser("first"));
    appendMessage(db, session.id, makeAssistant("reply1"), t1);
    appendMessage(db, session.id, makeUiMessage("OAuth progress"));
    const t2 = appendMessage(db, session.id, makeUser("second"));
    appendMessage(db, session.id, makeAssistant("reply2"), t2);
    appendMessage(db, session.id, makeUiMessage("Still visible"));

    const removed = undoLastTurn(db, session.id);
    expect(removed).toBe(true);

    const msgs = loadMessages(db, session.id);
    expect(msgs).toHaveLength(5);
    expect(msgs.map((msg) => msg.role)).toEqual([
      "ui",
      "user",
      "assistant",
      "ui",
      "ui",
    ]);
    expect((msgs[0] as ReturnType<typeof makeUiMessage>).content).toBe(
      "Help output",
    );
    expect((msgs[3] as ReturnType<typeof makeUiMessage>).content).toBe(
      "OAuth progress",
    );
    expect((msgs[4] as ReturnType<typeof makeUiMessage>).content).toBe(
      "Still visible",
    );
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

describe("prompt history", () => {
  test("listPromptHistory returns newest prompts first across sessions and CWDs", () => {
    const db = openDatabase(":memory:");
    const sessionA = createSession(db, { cwd: "/tmp/a" });
    const sessionB = createSession(db, { cwd: "/tmp/b" });

    appendPromptHistory(db, {
      text: "first prompt",
      cwd: sessionA.cwd,
      sessionId: sessionA.id,
    });
    appendPromptHistory(db, {
      text: "second prompt",
      cwd: sessionB.cwd,
      sessionId: sessionB.id,
    });
    appendPromptHistory(db, {
      text: "third prompt",
      cwd: sessionA.cwd,
    });

    const history = listPromptHistory(db);

    expect(history.map((entry) => entry.text)).toEqual([
      "third prompt",
      "second prompt",
      "first prompt",
    ]);
    expect(history.map((entry) => entry.cwd)).toEqual([
      "/tmp/a",
      "/tmp/b",
      "/tmp/a",
    ]);
    expect(history[0]?.sessionId).toBeNull();
    expect(history[1]?.sessionId).toBe(sessionB.id);
    expect(history[2]?.sessionId).toBe(sessionA.id);
    db.close();
  });

  test("listPromptHistory preserves duplicate prompts", () => {
    const db = openDatabase(":memory:");

    appendPromptHistory(db, { text: "repeat", cwd: "/tmp/test" });
    appendPromptHistory(db, { text: "repeat", cwd: "/tmp/test" });

    const history = listPromptHistory(db);

    expect(history).toHaveLength(2);
    expect(history[0]?.text).toBe("repeat");
    expect(history[1]?.text).toBe("repeat");
    expect(history[0]?.id).not.toBe(history[1]?.id);
    db.close();
  });

  test("truncatePromptHistory keeps the newest entries", () => {
    const db = openDatabase(":memory:");

    for (let i = 1; i <= 5; i++) {
      appendPromptHistory(db, {
        text: `prompt ${i}`,
        cwd: "/tmp/test",
      });
    }

    truncatePromptHistory(db, 3);

    expect(listPromptHistory(db).map((entry) => entry.text)).toEqual([
      "prompt 5",
      "prompt 4",
      "prompt 3",
    ]);
    db.close();
  });
});

describe("cumulative stats", () => {
  test("addMessageToStats adds assistant usage and ignores non-assistant messages", () => {
    let stats = {
      totalInput: 0,
      totalOutput: 0,
      totalCost: 0,
    };

    stats = addMessageToStats(
      stats,
      makeAssistant("done", {
        input: 200,
        output: 80,
        totalTokens: 280,
        cost: {
          input: 0.002,
          output: 0.003,
          cacheRead: 0,
          cacheWrite: 0,
          total: 0.005,
        },
      }),
    );
    stats = addMessageToStats(stats, makeUser("hello"));

    expect(stats).toEqual({
      totalInput: 200,
      totalOutput: 80,
      totalCost: 0.005,
    });
  });

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
    const messages = [
      makeUser("hello"),
      makeToolResult("tc1", "result"),
      makeUiMessage("Help output"),
    ];

    const stats = computeStats(messages);
    expect(stats.totalInput).toBe(0);
    expect(stats.totalOutput).toBe(0);
    expect(stats.totalCost).toBe(0);
  });

  test("filterModelMessages excludes UI messages", () => {
    const ui = makeUiMessage("Help output");
    const todoUi = makeUiTodoMessage();
    const user = makeUser("hello");
    const assistant = makeAssistant("reply");
    const messages = [ui, todoUi, user, assistant];

    const filtered = filterModelMessages(messages);

    expect(filtered).toHaveLength(2);
    expect(filtered[0]).toEqual(user);
    expect(filtered[1]).toEqual(assistant);
  });

  test("loadMessages round-trips UI todo messages", () => {
    const db = openDatabase(":memory:");
    const session = createSession(db, { cwd: "/tmp/project" });
    const todoUi = makeUiTodoMessage();

    try {
      appendMessage(db, session.id, todoUi);

      expect(loadMessages(db, session.id)).toEqual([todoUi]);
    } finally {
      db.close();
    }
  });

  test("computeContextTokens uses the latest valid assistant usage as the anchor", () => {
    const messages = [
      makeUser("first request"),
      makeAssistant("first reply", {
        input: 120,
        output: 30,
        cacheRead: 25,
        cacheWrite: 25,
        totalTokens: 0,
      }),
      makeUiMessage("ignored"),
      makeUser("follow-up"),
      makeToolResult("tc1", "done"),
    ];

    expect(computeContextTokens(messages)).toBe(204);
  });

  test("addMessageToContextTokens matches computeContextTokens across incremental updates", () => {
    const aborted = makeAssistant("partial reply");
    aborted.stopReason = "aborted";

    const messages = [
      makeUser("hello world"),
      makeAssistant("anchored reply", {
        input: 200,
        output: 50,
        totalTokens: 250,
      }),
      makeToolResult("tc1", "ls\nREADME.md"),
      aborted,
      makeUiMessage("ignored"),
      makeUser("follow-up"),
    ];

    let runningContextTokens = 0;
    for (const message of messages) {
      runningContextTokens = addMessageToContextTokens(
        runningContextTokens,
        message,
      );
    }

    expect(runningContextTokens).toBe(computeContextTokens(messages));
  });
});

describe("truncateSessions", () => {
  test("deletes oldest sessions beyond the keep limit for a CWD", () => {
    const db = openDatabase(":memory:");
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const s = createSession(db, { cwd: "/tmp/test" });
      ids.push(s.id);
    }

    truncateSessions(db, "/tmp/test", 3);

    const remaining = listSessions(db, "/tmp/test");
    expect(remaining).toHaveLength(3);
    // Most recent 3 survive (listSessions returns newest first)
    expect(remaining.map((s) => s.id)).toEqual([ids[4], ids[3], ids[2]]);
    db.close();
  });

  test("no-op when session count is within the limit", () => {
    const db = openDatabase(":memory:");
    for (let i = 0; i < 3; i++) {
      createSession(db, { cwd: "/tmp/test" });
    }

    truncateSessions(db, "/tmp/test", 5);

    const remaining = listSessions(db, "/tmp/test");
    expect(remaining).toHaveLength(3);
    db.close();
  });

  test("does not affect sessions in other CWDs", () => {
    const db = openDatabase(":memory:");
    for (let i = 0; i < 5; i++) {
      createSession(db, { cwd: "/tmp/a" });
    }
    for (let i = 0; i < 3; i++) {
      createSession(db, { cwd: "/tmp/b" });
    }

    truncateSessions(db, "/tmp/a", 2);

    expect(listSessions(db, "/tmp/a")).toHaveLength(2);
    expect(listSessions(db, "/tmp/b")).toHaveLength(3);
    db.close();
  });

  test("cascades to delete messages of truncated sessions", () => {
    const db = openDatabase(":memory:");
    const old = createSession(db, { cwd: "/tmp/test" });
    appendMessage(db, old.id, makeUser("hello"));
    const keep = createSession(db, { cwd: "/tmp/test" });
    appendMessage(db, keep.id, makeUser("world"));

    truncateSessions(db, "/tmp/test", 1);

    expect(listSessions(db, "/tmp/test")).toHaveLength(1);
    expect(loadMessages(db, old.id)).toHaveLength(0);
    expect(loadMessages(db, keep.id)).toHaveLength(1);
    db.close();
  });
});
