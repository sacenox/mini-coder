import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, renameSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

function getConfigDir(): string {
  return join(homedir(), ".config", "mini-coder");
}

function getDbPath(): string {
  const dir = getConfigDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return join(dir, "sessions.db");
}

const DB_VERSION = 6;

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS sessions (
    id          TEXT PRIMARY KEY,
    title       TEXT NOT NULL DEFAULT '',
    cwd         TEXT NOT NULL,
    model       TEXT NOT NULL,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS messages (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id  TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    payload     TEXT NOT NULL,
    turn_index  INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS prompt_history (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    text        TEXT NOT NULL,
    created_at  INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS mcp_servers (
    name        TEXT PRIMARY KEY,
    transport   TEXT NOT NULL,
    url         TEXT,
    command     TEXT,
    args        TEXT,
    env         TEXT,
    created_at  INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_messages_session
    ON messages(session_id, id);

  CREATE INDEX IF NOT EXISTS idx_messages_turn
    ON messages(session_id, turn_index);

  CREATE INDEX IF NOT EXISTS idx_sessions_updated
    ON sessions(updated_at DESC);

  CREATE TABLE IF NOT EXISTS settings (
    key         TEXT PRIMARY KEY,
    value       TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS model_capabilities (
    canonical_model_id TEXT PRIMARY KEY,
    context_window     INTEGER,
    max_output_tokens  INTEGER,
    reasoning          INTEGER NOT NULL,
    source_provider    TEXT,
    raw_json           TEXT,
    updated_at         INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS provider_models (
    provider           TEXT NOT NULL,
    provider_model_id  TEXT NOT NULL,
    display_name       TEXT NOT NULL,
    canonical_model_id TEXT,
    context_window     INTEGER,
    free               INTEGER,
    updated_at         INTEGER NOT NULL,
    PRIMARY KEY (provider, provider_model_id)
  );

  CREATE INDEX IF NOT EXISTS idx_provider_models_provider
    ON provider_models(provider);

  CREATE INDEX IF NOT EXISTS idx_provider_models_canonical
    ON provider_models(canonical_model_id);

  CREATE TABLE IF NOT EXISTS model_info_state (
    key                TEXT PRIMARY KEY,
    value              TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS oauth_tokens (
    provider       TEXT PRIMARY KEY,
    access_token   TEXT NOT NULL,
    refresh_token  TEXT NOT NULL,
    expires_at     INTEGER NOT NULL,
    updated_at     INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS logs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id  TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    level       TEXT NOT NULL,
    timestamp   INTEGER NOT NULL,
    data        TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_logs_session
    ON logs(session_id, timestamp DESC);
`;

let _db: Database | null = null;

export function isSqliteBusyError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const message = err.message.toLowerCase();
  return (
    message.includes("database is locked") || message.includes("sqlite_busy")
  );
}

function runBestEffortMaintenance(task: () => void): void {
  try {
    task();
  } catch (err) {
    if (!isSqliteBusyError(err)) throw err;
  }
}

function configureDb(db: Database): void {
  db.exec("PRAGMA journal_mode=WAL;");
  db.exec("PRAGMA foreign_keys=ON;");
  db.exec("PRAGMA busy_timeout=1000;");
}

function rotateDbFiles(dbPath: string, version: number): void {
  const backupBase = `${dbPath}.bak-v${version}-${Date.now()}`;
  for (const suffix of ["", "-wal", "-shm"]) {
    const path = `${dbPath}${suffix}`;
    if (!existsSync(path)) continue;
    renameSync(path, `${backupBase}${suffix}`);
  }
}

export function getDb(): Database {
  if (!_db) {
    const dbPath = getDbPath();
    const dbExists = existsSync(dbPath);
    let db = new Database(dbPath, { create: true });
    configureDb(db);

    const version =
      db.query<{ user_version: number }, []>("PRAGMA user_version").get()
        ?.user_version ?? 0;
    if (dbExists && version !== DB_VERSION) {
      try {
        db.close();
      } catch {
        // ignore
      }
      rotateDbFiles(dbPath, version);
      db = new Database(dbPath, { create: true });
      configureDb(db);
    }
    db.exec(SCHEMA);
    db.exec(`PRAGMA user_version = ${DB_VERSION};`);
    _db = db;
  }
  return _db;
}

/** Keep only this many most-recent sessions. */
const MAX_SESSIONS = 100;
/** Keep only this many most-recent prompt_history entries. */
const MAX_PROMPT_HISTORY = 500;

/**
 * Prune old sessions and prompt history, then reclaim space.
 * Call once at startup (after getDb()).
 */
export function pruneOldData(): void {
  const db = getDb();
  let deletedSessions = 0;
  let deletedHistory = 0;

  runBestEffortMaintenance(() => {
    deletedSessions = db.run(
      `DELETE FROM sessions WHERE id NOT IN (
       SELECT id FROM sessions ORDER BY updated_at DESC LIMIT ?
     )`,
      [MAX_SESSIONS],
    ).changes;

    deletedHistory = db.run(
      `DELETE FROM prompt_history WHERE id NOT IN (
       SELECT id FROM prompt_history ORDER BY id DESC LIMIT ?
     )`,
      [MAX_PROMPT_HISTORY],
    ).changes;
  });

  // Reclaim pages freed by deletions.
  if (deletedSessions > 0 || deletedHistory > 0) {
    // Defer VACUUM off the synchronous startup path so the CLI prompt
    // renders before the (potentially slow) page-reclaim scan runs.
    setImmediate(() => {
      runBestEffortMaintenance(() => {
        db.exec("VACUUM;");
      });
    });
  }

  // TRUNCATE checkpoint shrinks the WAL file to zero after writes are applied.
  // Falls back gracefully if another process holds a read lock (busy-safe).
  runBestEffortMaintenance(() => {
    db.exec("PRAGMA wal_checkpoint(TRUNCATE);");
  });
}
