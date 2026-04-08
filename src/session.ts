/**
 * Session persistence layer.
 *
 * Stores sessions and their message histories in a single SQLite database
 * via `bun:sqlite`. Messages are stored as JSON-serialized pi-ai {@link Message}
 * objects grouped by turn number. Cumulative token/cost stats are computed
 * from the message history rather than stored separately.
 *
 * @module
 */

import { Database } from "bun:sqlite";
import type { AssistantMessage, Message } from "@mariozechner/pi-ai";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A persisted session record.
 *
 * Represents a single conversation scoped to a working directory.
 * The `model` and `effort` fields reflect the values at session creation —
 * the user may switch models mid-session via `/model`, but the session
 * record is not updated (individual assistant messages carry their own model).
 */
export interface Session {
  /** Unique session identifier (UUID). */
  id: string;
  /** Working directory the session is scoped to. */
  cwd: string;
  /** Provider/model string at creation time, e.g. `"anthropic/claude-sonnet-4-20250514"`. */
  model: string | null;
  /** Thinking effort level at creation time. */
  effort: string | null;
  /** ID of the session this was forked from, or `null` if original. */
  forkedFrom: string | null;
  /** Unix timestamp in milliseconds when the session was created. */
  createdAt: number;
  /** Unix timestamp in milliseconds, updated on each new message. */
  updatedAt: number;
}

/**
 * Cumulative input/output token and cost statistics for a session.
 *
 * Computed by summing `usage` fields from all {@link AssistantMessage}s
 * in the session's history. Not stored — derived on load and maintained
 * in-memory during the session. These feed the status bar's cumulative
 * `in`, `out`, and `$cost` values; current context usage is estimated
 * separately from the current model-visible history.
 */
export interface SessionStats {
  /** Total input tokens across all assistant messages. */
  totalInput: number;
  /** Total output tokens across all assistant messages. */
  totalOutput: number;
  /** Total cost in dollars across all assistant messages. */
  totalCost: number;
}

/** A raw submitted prompt stored for global input-history search. */
interface PromptHistoryEntry {
  /** Monotonic row id. */
  id: number;
  /** Exact raw prompt text as submitted by the user. */
  text: string;
  /** Working directory where the prompt was submitted. */
  cwd: string;
  /** Originating session id when available. */
  sessionId: string | null;
  /** Unix timestamp in milliseconds when the prompt was submitted. */
  createdAt: number;
}

/** Options for appending a raw prompt-history entry. */
interface AppendPromptHistoryOpts {
  /** Exact raw prompt text as submitted by the user. */
  text: string;
  /** Working directory where the prompt was submitted. */
  cwd: string;
  /** Originating session id when available. */
  sessionId?: string;
}

/** A persisted UI-only message shown in the conversation log. */
export interface UiMessage {
  /** Identifies this as an internal UI message. */
  role: "ui";
  /** UI message category for rendering and future behavior. */
  kind: "info";
  /** Display text shown in the conversation log. */
  content: string;
  /** Unix timestamp in milliseconds. */
  timestamp: number;
}

/** Any message persisted in session history. */
type PersistedMessage = Message | UiMessage;

/** Options for creating a new session. */
interface CreateSessionOpts {
  /** Working directory to scope the session to. */
  cwd: string;
  /** Provider/model identifier, e.g. `"anthropic/claude-sonnet-4-20250514"`. */
  model?: string;
  /** Thinking effort level, e.g. `"medium"`. */
  effort?: string;
}

// ---------------------------------------------------------------------------
// Internal row types (map directly to SQLite column names)
// ---------------------------------------------------------------------------

/** Row shape returned by `SELECT * FROM sessions`. */
type SessionRow = {
  id: string;
  cwd: string;
  model: string | null;
  effort: string | null;
  forked_from: string | null;
  created_at: number;
  updated_at: number;
};

/** Row shape for `SELECT MAX(turn)` queries. */
type MaxTurnRow = { max_turn: number | null };

/** Row shape for `SELECT data` queries. */
type DataRow = { data: string };

/** Row shape returned by `SELECT * FROM prompt_history`. */
type PromptHistoryRow = {
  id: number;
  text: string;
  cwd: string;
  session_id: string | null;
  created_at: number;
};

// ---------------------------------------------------------------------------
// SQL
// ---------------------------------------------------------------------------

const SQL = {
  listSessions:
    "SELECT * FROM sessions WHERE cwd = ? ORDER BY updated_at DESC, rowid DESC",
  maxTurn: "SELECT MAX(turn) as max_turn FROM messages WHERE session_id = ?",
  loadMessages: "SELECT data FROM messages WHERE session_id = ? ORDER BY id",
  listPromptHistory:
    "SELECT * FROM prompt_history ORDER BY created_at DESC, id DESC LIMIT ?",
} as const;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT PRIMARY KEY,
  cwd         TEXT NOT NULL,
  model       TEXT,
  effort      TEXT,
  forked_from TEXT,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_cwd ON sessions(cwd);

CREATE TABLE IF NOT EXISTS messages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  turn        INTEGER,
  data        TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, turn);

CREATE TABLE IF NOT EXISTS prompt_history (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  text        TEXT NOT NULL,
  cwd         TEXT NOT NULL,
  session_id  TEXT,
  created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_prompt_history_created_at ON prompt_history(created_at, id);
`;

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------

/**
 * Open (or create) the SQLite database and ensure the schema exists.
 *
 * Enables WAL journal mode for concurrent read performance and foreign
 * keys for cascade deletes. Pass `":memory:"` for an in-memory database
 * (useful in tests).
 *
 * @param path - File path for the database, or `":memory:"` for in-memory.
 * @returns An open {@link Database} handle. The caller is responsible for
 *          closing it when done.
 *
 * @example
 * ```ts
 * const db = openDatabase("~/.config/mini-coder/mini-coder.db");
 * // ... use db ...
 * db.close();
 * ```
 */
export function openDatabase(path: string): Database {
  const db = new Database(path);
  db.run("PRAGMA journal_mode = WAL");
  db.run("PRAGMA foreign_keys = ON");
  db.exec(SCHEMA);
  return db;
}

// ---------------------------------------------------------------------------
// Session CRUD
// ---------------------------------------------------------------------------

function generateId(): string {
  return crypto.randomUUID();
}

/**
 * Create a new session record.
 *
 * @param db - Open database handle.
 * @param opts - Session options (cwd is required; model and effort are optional).
 * @returns The newly created {@link Session}.
 */
export function createSession(db: Database, opts: CreateSessionOpts): Session {
  const id = generateId();
  const now = Date.now();
  db.run(
    "INSERT INTO sessions (id, cwd, model, effort, forked_from, created_at, updated_at) VALUES (?, ?, ?, ?, NULL, ?, ?)",
    [id, opts.cwd, opts.model ?? null, opts.effort ?? null, now, now],
  );
  return {
    id,
    cwd: opts.cwd,
    model: opts.model ?? null,
    effort: opts.effort ?? null,
    forkedFrom: null,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Retrieve a session by its ID.
 *
 * @param db - Open database handle.
 * @param id - The session UUID.
 * @returns The {@link Session}, or `null` if not found.
 */
export function getSession(db: Database, id: string): Session | null {
  const row = db
    .query<SessionRow, [string]>("SELECT * FROM sessions WHERE id = ?")
    .get(id);
  if (!row) return null;
  return {
    id: row.id,
    cwd: row.cwd,
    model: row.model,
    effort: row.effort,
    forkedFrom: row.forked_from,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * List sessions for a working directory, most recently updated first.
 *
 * @param db - Open database handle.
 * @param cwd - Working directory to filter by.
 * @returns An array of {@link Session} records ordered by `updatedAt` descending.
 */
export function listSessions(db: Database, cwd: string): Session[] {
  const rows = db.query<SessionRow, [string]>(SQL.listSessions).all(cwd);
  return rows.map((row) => ({
    id: row.id,
    cwd: row.cwd,
    model: row.model,
    effort: row.effort,
    forkedFrom: row.forked_from,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

/**
 * Delete a session and all its messages (via foreign key cascade).
 *
 * @param db - Open database handle.
 * @param id - The session UUID to delete.
 */
export function deleteSession(db: Database, id: string): void {
  db.run("DELETE FROM sessions WHERE id = ?", [id]);
}

/**
 * Keep only the most recent sessions for a CWD, deleting the rest.
 *
 * Sessions are ordered by `updated_at DESC`; those beyond `keep` are
 * deleted (cascade removes their messages too). No-op if the count is
 * already within the limit.
 *
 * @param db - Open database handle.
 * @param cwd - Working directory to scope the truncation to.
 * @param keep - Maximum number of sessions to retain.
 */
export function truncateSessions(
  db: Database,
  cwd: string,
  keep: number,
): void {
  db.run(
    `DELETE FROM sessions WHERE id IN (
       SELECT id FROM sessions WHERE cwd = ?
       ORDER BY updated_at DESC, rowid DESC
       LIMIT -1 OFFSET ?
     )`,
    [cwd, keep],
  );
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

/**
 * Create a persisted UI message.
 *
 * @param content - Display text shown in the conversation log.
 * @returns A new {@link UiMessage}.
 */
export function createUiMessage(content: string): UiMessage {
  return {
    role: "ui",
    kind: "info",
    content,
    timestamp: Date.now(),
  };
}

/**
 * Check whether a persisted message is a UI-only message.
 *
 * @param message - Message to inspect.
 * @returns `true` when the message is a {@link UiMessage}.
 */
function isUiMessage(message: PersistedMessage): message is UiMessage {
  return message.role === "ui";
}

/**
 * Filter persisted session history down to model-visible pi-ai messages.
 *
 * @param messages - Persisted session history.
 * @returns Only the pi-ai {@link Message} entries.
 */
export function filterModelMessages(
  messages: readonly PersistedMessage[],
): Message[] {
  return messages.filter(
    (message): message is Message => !isUiMessage(message),
  );
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function readFiniteNumber(
  record: Record<string, unknown>,
  key: string,
): number | null {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Return an assistant message's usage when the persisted shape is valid.
 *
 * Session rows are treated as untrusted at runtime because older builds or
 * external tooling may have stored assistant messages without a `usage`
 * payload. Invalid or missing usage is ignored instead of crashing session
 * loading or stats calculations.
 *
 * @param message - Message to inspect.
 * @returns The assistant usage payload, or `null` when it is missing/invalid.
 */
export function getAssistantUsage(
  message: PersistedMessage | Message,
): AssistantMessage["usage"] | null {
  if (message.role !== "assistant") {
    return null;
  }

  const messageRecord = toRecord(message);
  const usageRecord = toRecord(messageRecord?.usage);
  const costRecord = toRecord(usageRecord?.cost);
  if (!usageRecord || !costRecord) {
    return null;
  }

  const input = readFiniteNumber(usageRecord, "input");
  const output = readFiniteNumber(usageRecord, "output");
  const cacheRead = readFiniteNumber(usageRecord, "cacheRead");
  const cacheWrite = readFiniteNumber(usageRecord, "cacheWrite");
  const totalTokens = readFiniteNumber(usageRecord, "totalTokens");
  const costInput = readFiniteNumber(costRecord, "input");
  const costOutput = readFiniteNumber(costRecord, "output");
  const costCacheRead = readFiniteNumber(costRecord, "cacheRead");
  const costCacheWrite = readFiniteNumber(costRecord, "cacheWrite");
  const costTotal = readFiniteNumber(costRecord, "total");

  if (
    input === null ||
    output === null ||
    cacheRead === null ||
    cacheWrite === null ||
    totalTokens === null ||
    costInput === null ||
    costOutput === null ||
    costCacheRead === null ||
    costCacheWrite === null ||
    costTotal === null
  ) {
    return null;
  }

  return {
    input,
    output,
    cacheRead,
    cacheWrite,
    totalTokens,
    cost: {
      input: costInput,
      output: costOutput,
      cacheRead: costCacheRead,
      cacheWrite: costCacheWrite,
      total: costTotal,
    },
  };
}

/**
 * Append a UI-only message to a session's history.
 *
 * UI messages are persisted with `turn = NULL` so they remain visible in
 * history without participating in conversational turn numbering or `/undo`.
 *
 * @param db - Open database handle.
 * @param sessionId - The session to append to.
 * @param message - The UI-only message to persist.
 * @param turn - Ignored for UI messages.
 * @returns `null`, since UI messages do not belong to conversational turns.
 */
export function appendMessage(
  db: Database,
  sessionId: string,
  message: UiMessage,
  turn?: number,
): null;

/**
 * Append a conversational message to a session's history.
 *
 * Turn numbering rules:
 * - When `turn` is **omitted**, a new turn is started with `MAX(turn) + 1`
 *   (or `1` for the first message). This is used for user messages.
 * - When `turn` is **provided**, the message joins that existing turn.
 *   This is used for assistant and tool-result messages that belong to
 *   the same agent loop as the initiating user message.
 *
 * Also updates the session's `updatedAt` timestamp.
 *
 * @param db - Open database handle.
 * @param sessionId - The session to append to.
 * @param message - A model-visible pi-ai message.
 * @param turn - Explicit turn number to join. Omit to start a new turn.
 * @returns The conversational turn number the message was stored with.
 */
export function appendMessage(
  db: Database,
  sessionId: string,
  message: Message,
  turn?: number,
): number;

/**
 * Append a persisted message to a session's history.
 *
 * UI messages always store `turn = NULL`. Conversational messages either start
 * a new turn or join an existing one, depending on `turn`.
 *
 * @param db - Open database handle.
 * @param sessionId - The session to append to.
 * @param message - Persisted message to store.
 * @param turn - Explicit conversational turn to join.
 * @returns The assigned conversational turn number, or `null` for UI messages.
 */
export function appendMessage(
  db: Database,
  sessionId: string,
  message: PersistedMessage,
  turn?: number,
): number | null;

/**
 * Append a persisted message to a session's history.
 *
 * UI messages always store `turn = NULL`. Conversational messages either start
 * a new turn or join an existing one, depending on `turn`.
 *
 * @param db - Open database handle.
 * @param sessionId - The session to append to.
 * @param message - Persisted message to store.
 * @param turn - Explicit conversational turn to join.
 * @returns The assigned conversational turn number, or `null` for UI messages.
 */
export function appendMessage(
  db: Database,
  sessionId: string,
  message: PersistedMessage,
  turn?: number,
): number | null {
  const now = Date.now();

  let effectiveTurn: number | null;
  if (isUiMessage(message)) {
    effectiveTurn = null;
  } else if (turn !== undefined) {
    effectiveTurn = turn;
  } else {
    const row = db.query<MaxTurnRow, [string]>(SQL.maxTurn).get(sessionId);
    effectiveTurn = (row?.max_turn ?? 0) + 1;
  }

  db.run(
    "INSERT INTO messages (session_id, turn, data, created_at) VALUES (?, ?, ?, ?)",
    [sessionId, effectiveTurn, JSON.stringify(message), now],
  );
  db.run("UPDATE sessions SET updated_at = ? WHERE id = ?", [now, sessionId]);

  return effectiveTurn;
}

/**
 * Load all messages for a session in insertion order.
 *
 * Messages are deserialized from their JSON representation back into
 * persisted app messages. The ordering matches the original append order
 * (by autoincrement `id`), preserving the conversation flow.
 *
 * @param db - Open database handle.
 * @param sessionId - The session to load messages for.
 * @returns An array of {@link PersistedMessage} objects, empty if the session
 *          has no messages or does not exist.
 */
export function loadMessages(
  db: Database,
  sessionId: string,
): PersistedMessage[] {
  const rows = db.query<DataRow, [string]>(SQL.loadMessages).all(sessionId);
  return rows.map((row) => JSON.parse(row.data) as PersistedMessage);
}

// ---------------------------------------------------------------------------
// Prompt history
// ---------------------------------------------------------------------------

/**
 * Append a raw submitted prompt to the global prompt-history table.
 *
 * This history is separate from conversational turn state: it is global,
 * append-only, and not affected by `/undo`.
 *
 * @param db - Open database handle.
 * @param opts - Prompt-history fields to persist.
 * @returns The stored {@link PromptHistoryEntry}.
 */
export function appendPromptHistory(
  db: Database,
  opts: AppendPromptHistoryOpts,
): PromptHistoryEntry {
  const now = Date.now();
  const result = db.run(
    "INSERT INTO prompt_history (text, cwd, session_id, created_at) VALUES (?, ?, ?, ?)",
    [opts.text, opts.cwd, opts.sessionId ?? null, now],
  );

  return {
    id: Number(result.lastInsertRowid),
    text: opts.text,
    cwd: opts.cwd,
    sessionId: opts.sessionId ?? null,
    createdAt: now,
  };
}

/**
 * List raw submitted prompts newest first.
 *
 * @param db - Open database handle.
 * @param limit - Maximum number of entries to return.
 * @returns Prompt-history entries ordered newest first.
 */
export function listPromptHistory(
  db: Database,
  limit = Number.MAX_SAFE_INTEGER,
): PromptHistoryEntry[] {
  const rows = db
    .query<PromptHistoryRow, [number]>(SQL.listPromptHistory)
    .all(limit);
  return rows.map((row) => ({
    id: row.id,
    text: row.text,
    cwd: row.cwd,
    sessionId: row.session_id,
    createdAt: row.created_at,
  }));
}

/**
 * Keep only the newest prompt-history rows.
 *
 * @param db - Open database handle.
 * @param keep - Maximum number of prompt-history rows to retain.
 */
export function truncatePromptHistory(db: Database, keep: number): void {
  db.run(
    `DELETE FROM prompt_history WHERE id IN (
       SELECT id FROM prompt_history
       ORDER BY created_at DESC, id DESC
       LIMIT -1 OFFSET ?
     )`,
    [keep],
  );
}

// ---------------------------------------------------------------------------
// Undo
// ---------------------------------------------------------------------------

/**
 * Remove the last turn from a session's history.
 *
 * Deletes **all** messages with the highest turn number — the user message
 * and every assistant/tool-result message that followed in the same agent
 * loop. This is a context-only operation; filesystem changes are not reverted.
 *
 * @param db - Open database handle.
 * @param sessionId - The session to undo in.
 * @returns `true` if a turn was removed, `false` if the session had no messages.
 */
export function undoLastTurn(db: Database, sessionId: string): boolean {
  const row = db.query<MaxTurnRow, [string]>(SQL.maxTurn).get(sessionId);
  if (!row?.max_turn) return false;

  db.run("DELETE FROM messages WHERE session_id = ? AND turn = ?", [
    sessionId,
    row.max_turn,
  ]);
  return true;
}

// ---------------------------------------------------------------------------
// Fork
// ---------------------------------------------------------------------------

/**
 * Fork a session into a new independent copy.
 *
 * Creates a new session with the same `cwd`, `model`, and `effort` as the
 * source, then copies all messages preserving their turn numbers. The new
 * session's `forkedFrom` field points back to the source. The original
 * session is not modified.
 *
 * @param db - Open database handle.
 * @param sourceId - The session to fork from.
 * @returns The newly created {@link Session}.
 * @throws If the source session does not exist.
 */
export function forkSession(db: Database, sourceId: string): Session {
  const source = getSession(db, sourceId);
  if (!source) throw new Error(`Session not found: ${sourceId}`);

  const id = generateId();
  const now = Date.now();

  db.run(
    "INSERT INTO sessions (id, cwd, model, effort, forked_from, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [id, source.cwd, source.model, source.effort, sourceId, now, now],
  );

  db.run(
    "INSERT INTO messages (session_id, turn, data, created_at) SELECT ?, turn, data, created_at FROM messages WHERE session_id = ? ORDER BY id",
    [id, sourceId],
  );

  return {
    id,
    cwd: source.cwd,
    model: source.model,
    effort: source.effort,
    forkedFrom: sourceId,
    createdAt: now,
    updatedAt: now,
  };
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

/**
 * Compute cumulative token and cost statistics from a message history.
 *
 * Iterates over the messages, summing `usage` fields from assistant messages
 * only (user and tool-result messages do not carry usage data). This is
 * designed to be called once on session load, with the result maintained
 * in-memory via a running accumulator during the session.
 *
 * @param messages - The full persisted message history for a session.
 * @returns Aggregated {@link SessionStats}.
 */
/**
 * Add one persisted message's assistant usage to cumulative session stats.
 *
 * Non-assistant messages and assistant messages without valid `usage` are
 * ignored and return the original totals unchanged.
 *
 * @param stats - Running cumulative session totals.
 * @param message - Persisted message to fold into the totals.
 * @returns Updated cumulative session stats.
 */
export function addMessageToStats(
  stats: SessionStats,
  message: PersistedMessage,
): SessionStats {
  const usage = getAssistantUsage(message);
  if (!usage) {
    return stats;
  }

  return {
    totalInput: stats.totalInput + usage.input,
    totalOutput: stats.totalOutput + usage.output,
    totalCost: stats.totalCost + usage.cost.total,
  };
}

export function computeStats(
  messages: readonly PersistedMessage[],
): SessionStats {
  let stats: SessionStats = {
    totalInput: 0,
    totalOutput: 0,
    totalCost: 0,
  };

  for (const message of messages) {
    stats = addMessageToStats(stats, message);
  }

  return stats;
}
