import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, unlinkSync } from "node:fs";
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

const DB_VERSION = 3;

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



  CREATE TABLE IF NOT EXISTS snapshots (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id  TEXT    NOT NULL,
    turn_index  INTEGER NOT NULL,
    path        TEXT    NOT NULL,
    content     BLOB,
    existed     INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_snapshots_turn
    ON snapshots(session_id, turn_index);
`;

let _db: Database | null = null;

export function getDb(): Database {
	if (!_db) {
		const dbPath = getDbPath();
		let db = new Database(dbPath, { create: true });
		db.exec("PRAGMA journal_mode=WAL;");
		db.exec("PRAGMA foreign_keys=ON;");

		const version =
			db.query<{ user_version: number }, []>("PRAGMA user_version").get()
				?.user_version ?? 0;
		if (version !== DB_VERSION) {
			try {
				db.close();
			} catch {
				// ignore
			}
			for (const path of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
				if (existsSync(path)) unlinkSync(path);
			}
			db = new Database(dbPath, { create: true });
			db.exec("PRAGMA journal_mode=WAL;");
			db.exec("PRAGMA foreign_keys=ON;");
			db.exec(SCHEMA);
			db.exec(`PRAGMA user_version = ${DB_VERSION};`);
		} else {
			db.exec(SCHEMA);
		}
		_db = db;
	}
	return _db;
}

/** Keep only this many most-recent sessions (messages/snapshots cascade). */
const MAX_SESSIONS = 100;
/** Keep only this many most-recent prompt_history entries. */
const MAX_PROMPT_HISTORY = 500;

/**
 * Prune old sessions and prompt history, then reclaim space.
 * Call once at startup (after getDb()).
 */
export function pruneOldData(): void {
	const db = getDb();

	const deletedSessions = db.run(
		`DELETE FROM sessions WHERE id NOT IN (
       SELECT id FROM sessions ORDER BY updated_at DESC LIMIT ?
     )`,
		[MAX_SESSIONS],
	).changes;

	const deletedHistory = db.run(
		`DELETE FROM prompt_history WHERE id NOT IN (
       SELECT id FROM prompt_history ORDER BY id DESC LIMIT ?
     )`,
		[MAX_PROMPT_HISTORY],
	).changes;

	// Reclaim pages freed by deletions.
	if (deletedSessions > 0 || deletedHistory > 0) {
		db.exec("VACUUM;");
	}

	// Checkpoint WAL (including any pages written by VACUUM) so the WAL file
	// shrinks back to near-zero.
	db.exec("PRAGMA wal_checkpoint(TRUNCATE);");
}
