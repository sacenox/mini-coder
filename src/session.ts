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
import type {
  AssistantMessage,
  Message,
  ToolResultMessage,
  UserMessage,
} from "@mariozechner/pi-ai";
import type { TodoItem } from "./tools.ts";

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

/** Session row used by the `/session` picker. */
export interface SessionListEntry extends Session {
  /** First conversational user message collapsed into a single-line preview, or `null` when none exists. */
  firstUserPreview: string | null;
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

/** A persisted UI-only info message shown in the conversation log. */
export interface UiInfoMessage {
  /** Identifies this as an internal UI message. */
  role: "ui";
  /** UI message category for rendering and future behavior. */
  kind: "info";
  /** Display text shown in the conversation log. */
  content: string;
  /** Unix timestamp in milliseconds. */
  timestamp: number;
}

/** A persisted UI-only todo snapshot shown in the conversation log. */
export interface UiTodoMessage {
  /** Identifies this as an internal UI message. */
  role: "ui";
  /** UI message category for rendering and future behavior. */
  kind: "todo";
  /** Todo snapshot rendered in the conversation pane. */
  todos: TodoItem[];
  /** Unix timestamp in milliseconds. */
  timestamp: number;
}

/** A persisted UI-only message shown in the conversation log. */
export type UiMessage = UiInfoMessage | UiTodoMessage;

/** Any message persisted in session history. */
export type PersistedMessage = Message | UiMessage;

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

/** Row shape returned by the `/session` picker query. */
type SessionListRow = SessionRow & {
  first_user_message_data: string | null;
};

/** Row shape for `SELECT MAX(turn)` queries. */
type MaxTurnRow = { max_turn: number | null };

/** Row shape for `SELECT data` queries. */
type DataRow = { data: string };

const EMPTY_ASSISTANT_USAGE: AssistantMessage["usage"] = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    total: 0,
  },
};

const SQLITE_BUSY_TIMEOUT_MS = 1_000;

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
  listSessions: `
    SELECT
      sessions.*,
      (
        SELECT data
        FROM messages
        WHERE session_id = sessions.id AND turn IS NOT NULL
        ORDER BY id
        LIMIT 1
      ) AS first_user_message_data
    FROM sessions
    WHERE cwd = ?
    ORDER BY updated_at DESC, rowid DESC
  `,
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
  db.run(`PRAGMA busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS}`);
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

/** Collapse preview text into a single readable line. */
function collapsePreviewText(text: string): string | null {
  const collapsed = text.replace(/\s+/g, " ").trim();
  return collapsed.length > 0 ? collapsed : null;
}

function getMultipartUserPreview(
  content: Extract<Message, { role: "user" }>["content"],
): string | null {
  if (typeof content === "string") {
    return collapsePreviewText(content);
  }

  const text = content
    .filter(
      (block): block is Extract<(typeof content)[number], { type: "text" }> => {
        return block.type === "text";
      },
    )
    .map((block) => block.text)
    .join(" ");

  return collapsePreviewText(text);
}

function isTextContentBlock(
  value: unknown,
): value is { type: "text"; text: string } {
  const record = toRecord(value);
  return record?.type === "text" && typeof record.text === "string";
}

function isImageContentBlock(
  value: unknown,
): value is { type: "image"; data: string; mimeType: string } {
  const record = toRecord(value);
  return (
    record?.type === "image" &&
    typeof record.data === "string" &&
    typeof record.mimeType === "string"
  );
}

function isThinkingContentBlock(
  value: unknown,
): value is Extract<AssistantMessage["content"][number], { type: "thinking" }> {
  const record = toRecord(value);
  return record?.type === "thinking" && typeof record.thinking === "string";
}

function isToolCallContentBlock(
  value: unknown,
): value is Extract<AssistantMessage["content"][number], { type: "toolCall" }> {
  const record = toRecord(value);
  return (
    record?.type === "toolCall" &&
    typeof record.id === "string" &&
    typeof record.name === "string" &&
    toRecord(record.arguments) !== null
  );
}

function isAssistantUsage(value: unknown): value is AssistantMessage["usage"] {
  const usageRecord = toRecord(value);
  const costRecord = toRecord(usageRecord?.cost);
  return (
    usageRecord !== null &&
    costRecord !== null &&
    readFiniteNumber(usageRecord, "input") !== null &&
    readFiniteNumber(usageRecord, "output") !== null &&
    readFiniteNumber(usageRecord, "cacheRead") !== null &&
    readFiniteNumber(usageRecord, "cacheWrite") !== null &&
    readFiniteNumber(usageRecord, "totalTokens") !== null &&
    readFiniteNumber(costRecord, "input") !== null &&
    readFiniteNumber(costRecord, "output") !== null &&
    readFiniteNumber(costRecord, "cacheRead") !== null &&
    readFiniteNumber(costRecord, "cacheWrite") !== null &&
    readFiniteNumber(costRecord, "total") !== null
  );
}

function isStopReason(value: unknown): value is AssistantMessage["stopReason"] {
  return (
    value === "stop" ||
    value === "length" ||
    value === "toolUse" ||
    value === "error" ||
    value === "aborted"
  );
}

function isUserMessageRecord(value: unknown): value is UserMessage {
  const record = toRecord(value);
  if (!record || record.role !== "user") {
    return false;
  }

  return (
    readFiniteNumber(record, "timestamp") !== null &&
    (typeof record.content === "string" ||
      (Array.isArray(record.content) &&
        record.content.every(
          (block) => isTextContentBlock(block) || isImageContentBlock(block),
        )))
  );
}

function parseAssistantMessageRecord(value: unknown): AssistantMessage | null {
  const record = toRecord(value);
  if (!record || record.role !== "assistant") {
    return null;
  }

  const timestamp = readFiniteNumber(record, "timestamp");
  if (
    !Array.isArray(record.content) ||
    !record.content.every(
      (block) =>
        isTextContentBlock(block) ||
        isThinkingContentBlock(block) ||
        isToolCallContentBlock(block),
    ) ||
    typeof record.api !== "string" ||
    typeof record.provider !== "string" ||
    typeof record.model !== "string" ||
    !isStopReason(record.stopReason) ||
    (record.errorMessage !== undefined &&
      typeof record.errorMessage !== "string") ||
    timestamp === null
  ) {
    return null;
  }

  return {
    role: "assistant",
    content: record.content,
    api: record.api,
    provider: record.provider,
    model: record.model,
    usage: isAssistantUsage(record.usage)
      ? record.usage
      : structuredClone(EMPTY_ASSISTANT_USAGE),
    stopReason: record.stopReason,
    ...(typeof record.errorMessage === "string"
      ? { errorMessage: record.errorMessage }
      : {}),
    timestamp,
  };
}

function isToolResultMessageRecord(value: unknown): value is ToolResultMessage {
  const record = toRecord(value);
  if (!record || record.role !== "toolResult") {
    return false;
  }

  return (
    typeof record.toolCallId === "string" &&
    typeof record.toolName === "string" &&
    typeof record.isError === "boolean" &&
    Array.isArray(record.content) &&
    record.content.every(
      (block) => isTextContentBlock(block) || isImageContentBlock(block),
    ) &&
    readFiniteNumber(record, "timestamp") !== null
  );
}

function isUiMessageRecord(value: unknown): value is UiMessage {
  const record = toRecord(value);
  if (!record || record.role !== "ui") {
    return false;
  }

  const timestamp = readFiniteNumber(record, "timestamp");
  if (timestamp === null) {
    return false;
  }

  if (record.kind === "info") {
    return typeof record.content === "string";
  }

  return (
    record.kind === "todo" &&
    Array.isArray(record.todos) &&
    record.todos.every(
      (todo) =>
        typeof todo === "object" &&
        todo !== null &&
        typeof (todo as { content?: unknown }).content === "string" &&
        ((todo as { status?: unknown }).status === "pending" ||
          (todo as { status?: unknown }).status === "in_progress" ||
          (todo as { status?: unknown }).status === "completed"),
    )
  );
}

function parsePersistedMessage(data: string): PersistedMessage | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data) as unknown;
  } catch {
    return null;
  }

  if (
    isUserMessageRecord(parsed) ||
    isToolResultMessageRecord(parsed) ||
    isUiMessageRecord(parsed)
  ) {
    return parsed;
  }

  return parseAssistantMessageRecord(parsed);
}

/** Read the first-user preview cached by the session-list query. */
function readFirstUserPreview(messageData: string | null): string | null {
  if (!messageData) {
    return null;
  }

  const message = parsePersistedMessage(messageData);
  if (!message || message.role !== "user") {
    return null;
  }

  return getMultipartUserPreview(message.content);
}

/**
 * List sessions for a working directory, most recently updated first.
 *
 * @param db - Open database handle.
 * @param cwd - Working directory to filter by.
 * @returns Session rows ordered by `updatedAt` descending, enriched with the first-user preview.
 */
export function listSessions(db: Database, cwd: string): SessionListEntry[] {
  const rows = db.query<SessionListRow, [string]>(SQL.listSessions).all(cwd);
  return rows.map((row) => ({
    id: row.id,
    cwd: row.cwd,
    model: row.model,
    effort: row.effort,
    forkedFrom: row.forked_from,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    firstUserPreview: readFirstUserPreview(row.first_user_message_data),
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
 * Create a persisted UI info message.
 *
 * @param content - Display text shown in the conversation log.
 * @returns A new {@link UiInfoMessage}.
 */
export function createUiMessage(content: string): UiInfoMessage {
  return {
    role: "ui",
    kind: "info",
    content,
    timestamp: Date.now(),
  };
}

/**
 * Create a persisted UI todo snapshot message.
 *
 * @param todos - Todo snapshot rendered in the conversation log.
 * @returns A new {@link UiTodoMessage}.
 */
export function createUiTodoMessage(todos: readonly TodoItem[]): UiTodoMessage {
  return {
    role: "ui",
    kind: "todo",
    todos: todos.map((todo) => ({ ...todo })),
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
  return typeof value === "object" && value !== null && !Array.isArray(value)
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

function runInImmediateTransaction<T>(db: Database, callback: () => T): T {
  if (db.inTransaction) {
    return callback();
  }

  db.run("BEGIN IMMEDIATE");
  try {
    const result = callback();
    db.run("COMMIT");
    return result;
  } catch (error) {
    if (db.inTransaction) {
      try {
        db.run("ROLLBACK");
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          "Failed to roll back SQLite transaction",
        );
      }
    }
    throw error;
  }
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
  return runInImmediateTransaction(db, () => {
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
  });
}

/**
 * Load all messages for a session in insertion order.
 *
 * Messages are deserialized from their JSON representation back into
 * persisted app messages. Invalid rows are skipped so corrupted session data
 * does not crash the app. The ordering matches the original append order
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
  const messages: PersistedMessage[] = [];

  for (const row of rows) {
    const message = parsePersistedMessage(row.data);
    if (message) {
      messages.push(message);
    }
  }

  return messages;
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

// ---------------------------------------------------------------------------
// Context estimation
// ---------------------------------------------------------------------------

/** Conservative fixed estimate for an image block's token footprint. */
const ESTIMATED_IMAGE_TOKENS = 1_200;

/** Calculate context tokens from assistant usage, falling back when `totalTokens` is zero. */
function calculateUsageTokens(usage: AssistantMessage["usage"]): number {
  return (
    usage.totalTokens ||
    usage.input + usage.output + usage.cacheRead + usage.cacheWrite
  );
}

/** Estimate token usage from a character count using a conservative chars/4 heuristic. */
function estimateCharacterTokens(charCount: number): number {
  return Math.ceil(charCount / 4);
}

type UserMultipartContent = Exclude<
  Extract<Message, { role: "user" }>["content"],
  string
>;
type TextOrImageContentBlock =
  | UserMultipartContent[number]
  | Extract<Message, { role: "toolResult" }>["content"][number];

function estimateTextOrImageContentTokens(
  content: readonly TextOrImageContentBlock[],
): number {
  let chars = 0;
  let imageTokens = 0;

  for (const block of content) {
    if (block.type === "text") {
      chars += block.text.length;
      continue;
    }
    if (block.type === "image") {
      imageTokens += ESTIMATED_IMAGE_TOKENS;
    }
  }

  return estimateCharacterTokens(chars) + imageTokens;
}

function estimateUserMessageTokens(
  message: Extract<Message, { role: "user" }>,
): number {
  if (typeof message.content === "string") {
    return estimateCharacterTokens(message.content.length);
  }
  return estimateTextOrImageContentTokens(message.content);
}

function estimateAssistantBlockCharacters(
  block: Extract<Message, { role: "assistant" }>["content"][number],
): number {
  if (block.type === "text") {
    return block.text.length;
  }
  if (block.type === "thinking") {
    return block.thinking.length;
  }
  return block.name.length + JSON.stringify(block.arguments).length;
}

function estimateAssistantMessageTokens(
  message: Extract<Message, { role: "assistant" }>,
): number {
  const chars = message.content.reduce((total, block) => {
    return total + estimateAssistantBlockCharacters(block);
  }, 0);
  return estimateCharacterTokens(chars);
}

function estimateToolResultMessageTokens(
  message: Extract<Message, { role: "toolResult" }>,
): number {
  return estimateTextOrImageContentTokens(message.content);
}

/** Estimate token usage for a model-visible message. */
function estimateMessageTokens(message: Message): number {
  switch (message.role) {
    case "user":
      return estimateUserMessageTokens(message);
    case "assistant":
      return estimateAssistantMessageTokens(message);
    case "toolResult":
      return estimateToolResultMessageTokens(message);
  }
}

/**
 * Fold one persisted message into the running context estimate for the next request.
 *
 * Assistant messages with valid usage anchor the full model-visible context for
 * that point in the transcript, so they replace the running estimate. All other
 * model-visible messages are added incrementally using the same conservative
 * estimation logic used before the first valid assistant usage appears.
 *
 * @param contextTokens - Running estimate before this message.
 * @param message - Persisted message to fold into the estimate.
 * @returns Updated context-token estimate.
 */
export function addMessageToContextTokens(
  contextTokens: number,
  message: PersistedMessage,
): number {
  if (message.role === "ui") {
    return contextTokens;
  }

  const usage = getAssistantUsage(message);
  if (
    message.role === "assistant" &&
    usage &&
    message.stopReason !== "aborted" &&
    message.stopReason !== "error"
  ) {
    return calculateUsageTokens(usage);
  }

  return contextTokens + estimateMessageTokens(message);
}

/**
 * Estimate the current model-visible context size for the next request.
 *
 * Recomputed on session-load boundaries and maintained incrementally during an
 * active turn so render-time status-bar updates do not need to rescan the full
 * message history.
 *
 * @param messages - Full persisted session history.
 * @returns Estimated context tokens visible to the next model request.
 */
export function computeContextTokens(
  messages: readonly PersistedMessage[],
): number {
  let contextTokens = 0;

  for (const message of messages) {
    contextTokens = addMessageToContextTokens(contextTokens, message);
  }

  return contextTokens;
}
