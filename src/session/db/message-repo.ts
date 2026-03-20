import { renderError } from "../../cli/output.ts";
import type { CoreMessage } from "../../llm-api/turn.ts";
import { getDb } from "./connection.ts";

// Hoist prepared statements to module-level lazy singletons so hot-path calls
// don't re-compile SQL every turn.
type Stmt = ReturnType<ReturnType<typeof getDb>["prepare"]>;
let _insertMsgStmt: Stmt | null = null;
let _addPromptHistoryStmt: Stmt | null = null;
let _getPromptHistoryStmt: Stmt | null = null;
function getInsertMsgStmt(): Stmt {
  if (!_insertMsgStmt) {
    _insertMsgStmt = getDb().prepare(
      `INSERT INTO messages (session_id, payload, turn_index, created_at)
     VALUES (?, ?, ?, ?)`,
    );
  }
  return _insertMsgStmt;
}

function getAddPromptHistoryStmt(): Stmt {
  if (!_addPromptHistoryStmt) {
    _addPromptHistoryStmt = getDb().prepare(
      "INSERT INTO prompt_history (text, created_at) VALUES (?, ?)",
    );
  }
  return _addPromptHistoryStmt;
}

function getPromptHistoryStmt(): Stmt {
  if (!_getPromptHistoryStmt) {
    _getPromptHistoryStmt = getDb().prepare(
      "SELECT text FROM prompt_history ORDER BY id DESC LIMIT ?",
    );
  }
  return _getPromptHistoryStmt;
}

export function saveMessages(
  sessionId: string,
  msgs: CoreMessage[],
  turnIndex = 0,
): void {
  const db = getDb();
  const stmt = getInsertMsgStmt();
  const now = Date.now();
  // Persistence invariant: write CoreMessage as lossless JSON (no reshaping) so
  // model-authored payloads round-trip exactly, including providerOptions /
  // providerMetadata thought signatures and part ordering required for Gemini
  // tool-call replay correctness.

  // Single transaction so all rows in a saveMessages call are flushed together
  // instead of triggering one implicit WAL flush per row.
  db.transaction(() => {
    for (const msg of msgs) {
      stmt.run(sessionId, JSON.stringify(msg), turnIndex, now);
    }
  })();
}

/**
 * Return the highest turn_index stored for this session, or -1 if none.
 */
export function getMaxTurnIndex(sessionId: string): number {
  const row = getDb()
    .query<
      { max_turn: number | null },
      [string]
    >("SELECT MAX(turn_index) AS max_turn FROM messages WHERE session_id = ?")
    .get(sessionId);
  return row?.max_turn ?? -1;
}

/**
 * Delete all messages belonging to a specific turn (when `turnIndex` is
 * provided) or the most recent turn (when omitted).
 * Returns true if anything was deleted.
 */
export function deleteLastTurn(sessionId: string, turnIndex?: number): boolean {
  const target =
    turnIndex !== undefined ? turnIndex : getMaxTurnIndex(sessionId);
  if (target < 0) return false;
  getDb().run("DELETE FROM messages WHERE session_id = ? AND turn_index = ?", [
    sessionId,
    target,
  ]);
  return true;
}

export function loadMessages(sessionId: string): CoreMessage[] {
  const rows = getDb()
    .query<
      { payload: string; id: number },
      [string]
    >("SELECT payload, id FROM messages WHERE session_id = ? ORDER BY id ASC")
    .all(sessionId);

  const messages: CoreMessage[] = [];
  // Persistence invariant: load by parsing stored JSON verbatim; do not
  // reconstruct tool-call history or normalize parts, because model-authored
  // messages must round-trip exactly (providerOptions / providerMetadata thought
  // signatures + part ordering) for Gemini replay correctness.

  for (const row of rows) {
    try {
      messages.push(JSON.parse(row.payload) as CoreMessage);
    } catch (_err) {
      renderError(
        new Error(
          `Failed to parse message ID ${row.id} for session ${sessionId}`,
        ),
      );
    }
  }
  return messages;
}

export function addPromptHistory(text: string): void {
  const trimmed = text.trim();
  if (!trimmed) return;
  getAddPromptHistoryStmt().run(trimmed, Date.now());
}

export function getPromptHistory(limit = 200): string[] {
  const rows = getPromptHistoryStmt().all(limit) as Array<{ text: string }>;
  return rows.map((r) => r.text).reverse();
}
