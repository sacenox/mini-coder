import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export function getConfigDir(): string {
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
