import { getDb } from "./connection.ts";

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
