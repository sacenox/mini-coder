/**
 * SQLite-based turn snapshots for /undo.
 *
 * Before each agent turn we inspect the git working tree (via `git status`) and
 * store the contents of every dirty file in the SQLite database.  On /undo we
 * restore those files from the DB and clean up the snapshot row(s).
 *
 * This approach is completely invisible to the user: no stash entries, no
 * commits, no impact on `git status` / `git log` / `git add`.
 *
 * Snapshotting is skipped silently when:
 *   - the cwd is not inside a git repository, or
 *   - the working tree is already clean (nothing to snapshot).
 *
 * Both functions never throw.
 */

import { readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import {
	type SnapshotFile,
	deleteSnapshot,
	loadSnapshot,
	saveSnapshot,
} from "../session/db/index.ts";

// ─── Types ────────────────────────────────────────────────────────────────────

export type SnapshotRestoreResult =
	| { restored: true }
	| { restored: false; reason: "not-found" | "error" };

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Run a git command and return { stdout as raw bytes, code }. Never throws. */
async function gitBytes(
	args: string[],
	cwd: string,
): Promise<{ bytes: Uint8Array; code: number }> {
	try {
		const proc = Bun.spawn(["git", ...args], {
			cwd,
			stdout: "pipe",
			stderr: "pipe",
		});
		const [bytes] = await Promise.all([
			new Response(proc.stdout).bytes(),
			new Response(proc.stderr).bytes(),
		]);
		const code = await proc.exited;
		return { bytes, code };
	} catch {
		return { bytes: new Uint8Array(), code: -1 };
	}
}

/** Run a git command and return { stdout as text, code }. Never throws. */
async function git(
	args: string[],
	cwd: string,
): Promise<{ stdout: string; code: number }> {
	const { bytes, code } = await gitBytes(args, cwd);
	return { stdout: new TextDecoder().decode(bytes), code };
}

/**
 * Parse `git status --porcelain -z` output into a list of affected relative paths.
 * Returns null when git is unavailable or cwd is not a repo.
 *
 * With -z, the format is NUL-delimited entries: "XY PATH" for normal entries,
 * and "R  NEW\0OLD" (or "C  NEW\0OLD") for renames/copies — meaning the new
 * (destination) path is in the entry itself, and the old (source) path follows
 * as the next NUL-delimited token.
 *
 * Status codes we care about:
 *   M  modified (tracked)
 *   A  added to index (tracked but new)
 *   D  deleted (tracked)
 *   R  renamed — snapshot old (source) path content; new path is untracked-style
 *   C  copied — snapshot the new path
 *   ?  untracked
 */
interface StatusEntry {
	/** Path relative to repo root */
	path: string;
	/** True if the file currently exists on disk */
	existsOnDisk: boolean;
	/** True if the file is brand-new and not in HEAD (untracked, not yet committed) */
	isNew: boolean;
}

/**
 * Parse `git status` for the given repo root.
 * Assumes the caller has already verified we're inside a git repo.
 */
async function getStatusEntries(
	repoRoot: string,
): Promise<StatusEntry[] | null> {
	// -u / --untracked-files=all enumerates individual files inside new directories
	// rather than collapsing them to a single "?? dir/" entry.
	const status = await git(["status", "--porcelain", "-z", "-u"], repoRoot);
	if (status.code !== 0) return null;

	const raw = status.stdout;
	if (raw === "") return []; // clean tree

	const entries: StatusEntry[] = [];
	const parts = raw.split("\0");
	let i = 0;
	while (i < parts.length) {
		const entry = parts[i];
		i++;
		if (!entry || entry.length < 4) continue;

		const xy = entry.slice(0, 2);
		const filePath = entry.slice(3); // for renames: this is the NEW (destination) path
		const x = xy[0] ?? " "; // index status
		const y = xy[1] ?? " "; // worktree status

		if (x === "R" || x === "C") {
			// With --porcelain -z: entry contains NEW path; next token is OLD (source) path.
			const oldPath = parts[i];
			i++;
			// Old/source path: deleted from working tree — existed in HEAD, capture content
			if (oldPath) {
				entries.push({ path: oldPath, existsOnDisk: false, isNew: false });
			}
			// New/destination path: exists on disk, not in HEAD yet
			if (filePath) {
				entries.push({ path: filePath, existsOnDisk: true, isNew: true });
			}
			continue;
		}

		if (x === "D" || y === "D") {
			// Deleted — file no longer exists on disk but was in HEAD
			if (filePath)
				entries.push({ path: filePath, existsOnDisk: false, isNew: false });
			continue;
		}

		if (x === "?" && y === "?") {
			// Untracked — file exists on disk and is brand-new (not in HEAD)
			if (filePath)
				entries.push({ path: filePath, existsOnDisk: true, isNew: true });
			continue;
		}

		// All other cases (M, A, U, etc.) — file exists on disk and was in HEAD
		if (filePath)
			entries.push({ path: filePath, existsOnDisk: true, isNew: false });
	}

	// Deduplicate by path (renames can produce duplicates)
	const seen = new Set<string>();
	return entries.filter((e) => {
		if (seen.has(e.path)) return false;
		seen.add(e.path);
		return true;
	});
}

/** Get the repo root so we can resolve paths relative to cwd correctly. */
async function getRepoRoot(cwd: string): Promise<string | null> {
	const result = await git(["rev-parse", "--show-toplevel"], cwd);
	if (result.code !== 0) return null;
	return result.stdout.trim();
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Snapshot the current working tree state before a turn.
 * Returns true if a snapshot was created (there were dirty files), false otherwise.
 */
export async function takeSnapshot(
	cwd: string,
	sessionId: string,
	turnIndex: number,
): Promise<boolean> {
	try {
		// A single rev-parse establishes both "are we in a repo" and the root path.
		const repoRoot = await getRepoRoot(cwd);
		if (repoRoot === null) return false;

		const entries = await getStatusEntries(repoRoot);

		// git status failed
		if (entries === null) return false;
		// Clean working tree — nothing to snapshot
		if (entries.length === 0) return false;

		const files: SnapshotFile[] = [];

		for (const entry of entries) {
			const absPath = join(repoRoot, entry.path);

			if (!entry.existsOnDisk) {
				// File was deleted before this turn — retrieve its content from HEAD
				// so we can restore it on undo. Binary-safe: read as raw bytes.
				const { bytes, code } = await gitBytes(
					["show", `HEAD:${entry.path}`],
					repoRoot,
				);
				if (code === 0) {
					files.push({
						path: entry.path,
						content: bytes,
						existed: true,
					});
				}
				continue;
			}

			if (entry.isNew) {
				// File exists on disk but is not in HEAD (untracked or rename destination).
				// On undo we should delete it, not restore content — mark existed=false.
				// We still read the content so it can be re-created if needed in future,
				// but the restore logic uses existed to decide delete vs. overwrite.
				try {
					const content = readFileSync(absPath);
					files.push({
						path: entry.path,
						content: new Uint8Array(content),
						existed: false,
					});
				} catch {
					// Race condition: file removed after status. Skip it.
				}
				continue;
			}

			// File exists on disk and was in HEAD — read its current content
			try {
				const content = readFileSync(absPath);
				files.push({
					path: entry.path,
					content: new Uint8Array(content),
					existed: true,
				});
			} catch {
				// Race condition: file removed after status. Skip it.
			}
		}

		if (files.length === 0) return false;

		saveSnapshot(sessionId, turnIndex, files);
		return true;
	} catch {
		return false;
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
		const repoRoot = await getRepoRoot(cwd);

		if (files.length === 0) return { restored: false, reason: "not-found" };

		// We need the repo root to resolve paths; fall back to cwd if unavailable
		const root = repoRoot ?? cwd;

		let anyFailed = false;

		for (const file of files) {
			const absPath = join(root, file.path);

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
