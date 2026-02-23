import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { CoreMessage } from "../llm-api/turn.ts";

// ─── Config dir ───────────────────────────────────────────────────────────────

export function getConfigDir(): string {
	return join(homedir(), ".config", "mini-coder");
}

function getDbPath(): string {
	const dir = getConfigDir();
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
	return join(dir, "sessions.db");
}

// ─── Schema ───────────────────────────────────────────────────────────────────

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

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SessionRow {
	id: string;
	title: string;
	cwd: string;
	model: string;
	created_at: number;
	updated_at: number;
}

// ─── DB singleton ─────────────────────────────────────────────────────────────

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

// ─── Session CRUD ─────────────────────────────────────────────────────────────

export function createSession(opts: {
	id: string;
	title?: string;
	cwd: string;
	model: string;
}): SessionRow {
	const db = getDb();
	const now = Date.now();
	db.run(
		`INSERT INTO sessions (id, title, cwd, model, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
		[opts.id, opts.title ?? "", opts.cwd, opts.model, now, now],
	);
	const session = getSession(opts.id);
	if (!session) {
		throw new Error(`Failed to create session ${opts.id}`);
	}
	return session;
}

export function getSession(id: string): SessionRow | null {
	return (
		getDb()
			.query<SessionRow, [string]>("SELECT * FROM sessions WHERE id = ?")
			.get(id) ?? null
	);
}

export function updateSessionTitle(id: string, title: string): void {
	getDb().run("UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?", [
		title,
		Date.now(),
		id,
	]);
}

export function touchSession(id: string, model: string): void {
	getDb().run("UPDATE sessions SET updated_at = ?, model = ? WHERE id = ?", [
		Date.now(),
		model,
		id,
	]);
}

export function listSessions(limit = 20): SessionRow[] {
	return getDb()
		.query<SessionRow, [number]>(
			"SELECT * FROM sessions ORDER BY updated_at DESC LIMIT ?",
		)
		.all(limit);
}

export function deleteSession(id: string): void {
	getDb().run("DELETE FROM sessions WHERE id = ?", [id]);
}

// ─── Message CRUD ─────────────────────────────────────────────────────────────

export function saveMessage(
	sessionId: string,
	msg: CoreMessage,
	turnIndex = 0,
): void {
	getDb().run(
		`INSERT INTO messages (session_id, payload, turn_index, created_at)
     VALUES (?, ?, ?, ?)`,
		[sessionId, JSON.stringify(msg), turnIndex, Date.now()],
	);
}

export function saveMessages(
	sessionId: string,
	msgs: CoreMessage[],
	turnIndex = 0,
): void {
	const db = getDb();
	const stmt = db.prepare(
		`INSERT INTO messages (session_id, payload, turn_index, created_at)
     VALUES (?, ?, ?, ?)`,
	);
	const now = Date.now();
	for (const msg of msgs) {
		stmt.run(sessionId, JSON.stringify(msg), turnIndex, now);
	}
}

/**
 * Return the highest turn_index stored for this session, or -1 if none.
 */
export function getMaxTurnIndex(sessionId: string): number {
	const row = getDb()
		.query<{ max_turn: number | null }, [string]>(
			"SELECT MAX(turn_index) AS max_turn FROM messages WHERE session_id = ?",
		)
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
		.query<{ payload: string }, [string]>(
			"SELECT payload FROM messages WHERE session_id = ? ORDER BY id ASC",
		)
		.all(sessionId);

	return rows.map((row) => JSON.parse(row.payload) as CoreMessage);
}

// ─── Prompt history ───────────────────────────────────────────────────────────

export function addPromptHistory(text: string): void {
	if (!text.trim()) return;
	getDb().run("INSERT INTO prompt_history (text, created_at) VALUES (?, ?)", [
		text.trim(),
		Date.now(),
	]);
}

export function getPromptHistory(limit = 200): string[] {
	const rows = getDb()
		.query<{ text: string }, [number]>(
			"SELECT text FROM prompt_history ORDER BY id DESC LIMIT ?",
		)
		.all(limit);
	return rows.map((r) => r.text).reverse();
}

// ─── MCP server CRUD ──────────────────────────────────────────────────────────

export interface McpServerRow {
	name: string;
	transport: string;
	url: string | null;
	command: string | null;
	args: string | null; // JSON array
	env: string | null; // JSON object
}

export function listMcpServers(): McpServerRow[] {
	return getDb()
		.query<McpServerRow, []>(
			"SELECT name, transport, url, command, args, env FROM mcp_servers ORDER BY name",
		)
		.all();
}

export function upsertMcpServer(server: McpServerRow): void {
	getDb().run(
		`INSERT INTO mcp_servers (name, transport, url, command, args, env, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(name) DO UPDATE SET
       transport = excluded.transport,
       url       = excluded.url,
       command   = excluded.command,
       args      = excluded.args,
       env       = excluded.env`,
		[
			server.name,
			server.transport,
			server.url ?? null,
			server.command ?? null,
			server.args ?? null,
			server.env ?? null,
			Date.now(),
		],
	);
}

export function deleteMcpServer(name: string): void {
	getDb().run("DELETE FROM mcp_servers WHERE name = ?", [name]);
}

// ─── Settings ─────────────────────────────────────────────────────────────────

export function getSetting(key: string): string | null {
	const row = getDb()
		.query<{ value: string }, [string]>(
			"SELECT value FROM settings WHERE key = ?",
		)
		.get(key);
	return row?.value ?? null;
}

export function setSetting(key: string, value: string): void {
	getDb().run(
		`INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
		[key, value],
	);
}

export function getPreferredModel(): string | null {
	return getSetting("preferred_model");
}

export function setPreferredModel(model: string): void {
	setSetting("preferred_model", model);
}

// ─── Snapshots ────────────────────────────────────────────────────────────────

export interface SnapshotFile {
	/** Path relative to the project cwd */
	path: string;
	/** Raw file contents, or null if the file did not exist before the turn */
	content: Uint8Array | null;
	/** True if the file existed before the turn; false if the agent created it */
	existed: boolean;
}

export function saveSnapshot(
	sessionId: string,
	turnIndex: number,
	files: SnapshotFile[],
): void {
	const db = getDb();
	const stmt = db.prepare(
		`INSERT INTO snapshots (session_id, turn_index, path, content, existed)
     VALUES (?, ?, ?, ?, ?)`,
	);
	const insert = db.transaction(() => {
		for (const f of files) {
			stmt.run(
				sessionId,
				turnIndex,
				f.path,
				f.content ?? null,
				f.existed ? 1 : 0,
			);
		}
	});
	insert();
}

export function loadSnapshot(
	sessionId: string,
	turnIndex: number,
): SnapshotFile[] {
	const rows = getDb()
		.query<
			{ path: string; content: Uint8Array | null; existed: number },
			[string, number]
		>(
			"SELECT path, content, existed FROM snapshots WHERE session_id = ? AND turn_index = ?",
		)
		.all(sessionId, turnIndex);
	return rows.map((r) => ({
		path: r.path,
		content: r.content ?? null,
		existed: r.existed === 1,
	}));
}

export function deleteSnapshot(sessionId: string, turnIndex: number): void {
	getDb().run("DELETE FROM snapshots WHERE session_id = ? AND turn_index = ?", [
		sessionId,
		turnIndex,
	]);
}

/** Delete all snapshot rows for a session (e.g. on session reset). */
export function deleteAllSnapshots(sessionId: string): void {
	getDb().run("DELETE FROM snapshots WHERE session_id = ?", [sessionId]);
}

// ─── ID generation ────────────────────────────────────────────────────────────

/** Generate a short session ID: timestamp + random suffix */
export function generateSessionId(): string {
	const ts = Date.now().toString(36);
	const rand = Math.random().toString(36).slice(2, 7);
	return `${ts}-${rand}`;
}
