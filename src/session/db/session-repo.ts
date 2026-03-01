import { getDb } from "./connection.ts";

export interface SessionRow {
	id: string;
	title: string;
	cwd: string;
	model: string;
	created_at: number;
	updated_at: number;
}

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

/** Generate a short session ID: timestamp + random suffix */
export function generateSessionId(): string {
	const ts = Date.now().toString(36);
	const rand = Math.random().toString(36).slice(2, 7);
	return `${ts}-${rand}`;
}
