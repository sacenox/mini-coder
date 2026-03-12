/**
 * SQLite-based turn snapshots for /undo.
 *
 * Before an agent makes a file modification (create, replace, insert),
 * we hook in to snapshot the exact state of that file on disk.
 *
 * On /undo, we restore those files from the DB and clean up the snapshot rows.
 */

import { unlinkSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import {
	deleteSnapshot,
	loadSnapshot,
	saveSnapshot,
} from "../session/db/index.ts";

// ─── Types ────────────────────────────────────────────────────────────────────

export type SnapshotRestoreResult =
	| { restored: true }
	| { restored: false; reason: "not-found" | "error" };

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Snapshot a file's state before editing it, if it hasn't been snapshotted this turn.
 * Does not throw.
 */
export async function snapshotBeforeEdit(
	cwd: string,
	sessionId: string,
	turnIndex: number,
	filePath: string,
	snappedPaths: Set<string>,
): Promise<void> {
	try {
		const absPath = isAbsolute(filePath) ? filePath : join(cwd, filePath);
		const relPath = isAbsolute(filePath) ? relative(cwd, filePath) : filePath;

		if (snappedPaths.has(relPath)) return;
		snappedPaths.add(relPath);

		let existed = false;
		let content: Uint8Array | null = null;

		const file = Bun.file(absPath);
		if (await file.exists()) {
			existed = true;
			content = new Uint8Array(await file.arrayBuffer());
		}

		saveSnapshot(sessionId, turnIndex, [{ path: relPath, content, existed }]);
	} catch {
		// Ignore errors — undo is a best-effort mechanism
	}
}

/**
 * Restore files from the snapshot for the given turn and remove the snapshot.
 * Returns whether files were restored.
 */
export async function restoreSnapshot(
	cwd: string,
	sessionId: string,
	turnIndex: number,
): Promise<SnapshotRestoreResult> {
	try {
		const files = loadSnapshot(sessionId, turnIndex);

		if (files.length === 0) return { restored: false, reason: "not-found" };

		let anyFailed = false;

		for (const file of files) {
			const absPath = join(cwd, file.path);

			if (!file.existed) {
				// File was created by the agent (or is a rename destination) — delete it
				try {
					if (await Bun.file(absPath).exists()) {
						unlinkSync(absPath);
					}
				} catch {
					anyFailed = true;
				}
				continue;
			}

			// File existed before — restore its content
			if (file.content !== null) {
				try {
					await Bun.write(absPath, file.content);
				} catch {
					anyFailed = true;
				}
			}
		}

		// Only delete the snapshot when all files were restored successfully.
		// If any write failed, keep the snapshot so a retry is possible.
		if (!anyFailed) {
			deleteSnapshot(sessionId, turnIndex);
		}
		return anyFailed
			? { restored: false, reason: "error" }
			: { restored: true };
	} catch {
		return { restored: false, reason: "error" };
	}
}
