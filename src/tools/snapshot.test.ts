import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	deleteSnapshot,
	loadSnapshot,
	saveSnapshot,
} from "../session/db/index.ts";
import { restoreSnapshot, takeSnapshot } from "./snapshot.ts";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function spawnSync(args: string[], cwd: string): void {
	const proc = Bun.spawnSync(args, { cwd, stdout: "pipe", stderr: "pipe" });
	if (proc.exitCode !== 0) {
		throw new Error(
			`Command failed: ${args.join(" ")}\n${proc.stderr.toString()}`,
		);
	}
}

/** Create a minimal git repo in a temp directory and return its path. */
function makeRepo(): string {
	const dir = join(
		tmpdir(),
		`mc-snap-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	mkdirSync(dir, { recursive: true });
	spawnSync(["git", "init"], dir);
	spawnSync(["git", "config", "user.email", "test@example.com"], dir);
	spawnSync(["git", "config", "user.name", "Test"], dir);
	// Initial commit so HEAD exists
	writeFileSync(join(dir, "README.md"), "hello\n");
	spawnSync(["git", "add", "README.md"], dir);
	spawnSync(["git", "commit", "-m", "init"], dir);
	return dir;
}

function cleanRepo(dir: string): void {
	rmSync(dir, { recursive: true, force: true });
}

function useTestRepo() {
	const state = { repoDir: "", sessionId: crypto.randomUUID() };
	beforeEach(() => {
		state.repoDir = makeRepo();
	});
	afterEach(() => {
		cleanRepo(state.repoDir);
	});
	return state;
}

// ─── db helpers ───────────────────────────────────────────────────────────────

describe("saveSnapshot / loadSnapshot / deleteSnapshot", () => {
	test("round-trips file entries", () => {
		const sessionId = crypto.randomUUID();
		const turnIndex = 42;
		const content = new TextEncoder().encode("hello world");

		saveSnapshot(sessionId, turnIndex, [
			{ path: "src/foo.ts", content, existed: true },
			{ path: "src/new.ts", content: null, existed: false },
		]);

		const rows = loadSnapshot(sessionId, turnIndex);
		expect(rows).toHaveLength(2);

		const foo = rows.find((r) => r.path === "src/foo.ts");
		expect(foo?.existed).toBe(true);
		expect(foo?.content).toEqual(content);

		const newFile = rows.find((r) => r.path === "src/new.ts");
		expect(newFile?.existed).toBe(false);
		expect(newFile?.content).toBeNull();

		// Cleanup
		deleteSnapshot(sessionId, turnIndex);
		expect(loadSnapshot(sessionId, turnIndex)).toHaveLength(0);
	});
});

// ─── takeSnapshot ─────────────────────────────────────────────────────────────

describe("takeSnapshot", () => {
	const state = useTestRepo();

	test("returns false on a clean working tree", async () => {
		const result = await takeSnapshot(state.repoDir, state.sessionId, 1);
		expect(result).toBe(false);
	});

	test("returns false for a non-git directory", async () => {
		const nonGit = join(tmpdir(), `mc-nongit-${Date.now()}`);
		mkdirSync(nonGit, { recursive: true });
		try {
			const result = await takeSnapshot(nonGit, state.sessionId, 2);
			expect(result).toBe(false);
		} finally {
			rmSync(nonGit, { recursive: true, force: true });
		}
	});

	test("snapshots a modified tracked file", async () => {
		const filePath = join(state.repoDir, "README.md");
		writeFileSync(filePath, "modified content\n");

		const result = await takeSnapshot(state.repoDir, state.sessionId, 3);
		expect(result).toBe(true);

		const rows = loadSnapshot(state.sessionId, 3);
		const readme = rows.find((r) => r.path === "README.md");
		expect(readme).toBeDefined();
		expect(readme?.existed).toBe(true);
		expect(new TextDecoder().decode(readme?.content ?? undefined)).toBe(
			"modified content\n",
		);

		deleteSnapshot(state.sessionId, 3);
	});

	test("snapshots an untracked new file with existed=false", async () => {
		writeFileSync(join(state.repoDir, "untracked.txt"), "brand new\n");

		const result = await takeSnapshot(state.repoDir, state.sessionId, 4);
		expect(result).toBe(true);

		const rows = loadSnapshot(state.sessionId, 4);
		const f = rows.find((r) => r.path === "untracked.txt");
		expect(f).toBeDefined();
		// Untracked files are new — on undo they should be deleted, not written back
		expect(f?.existed).toBe(false);

		deleteSnapshot(state.sessionId, 4);
	});

	test("snapshots files inside a new untracked directory", async () => {
		// Without -u, git collapses new dirs to a single "?? dir/" entry.
		// With -u, each file inside is listed individually.
		mkdirSync(join(state.repoDir, "src"), { recursive: true });
		writeFileSync(join(state.repoDir, "src", "a.ts"), "export const a = 1;\n");
		writeFileSync(join(state.repoDir, "src", "b.ts"), "export const b = 2;\n");

		const result = await takeSnapshot(state.repoDir, state.sessionId, 5);
		expect(result).toBe(true);

		const rows = loadSnapshot(state.sessionId, 5);
		const a = rows.find((r) => r.path === "src/a.ts");
		const b = rows.find((r) => r.path === "src/b.ts");
		expect(a).toBeDefined();
		expect(b).toBeDefined();
		expect(a?.existed).toBe(false);
		expect(b?.existed).toBe(false);

		deleteSnapshot(state.sessionId, 5);
	});

	test("snapshots a renamed file correctly", async () => {
		// Commit a file so it's tracked, then rename it
		writeFileSync(join(state.repoDir, "old-name.ts"), "export const x = 1;\n");
		spawnSync(["git", "add", "old-name.ts"], state.repoDir);
		spawnSync(["git", "commit", "-m", "add file"], state.repoDir);

		// Rename tracked file
		spawnSync(["git", "mv", "old-name.ts", "new-name.ts"], state.repoDir);

		const result = await takeSnapshot(state.repoDir, state.sessionId, 6);
		expect(result).toBe(true);

		const rows = loadSnapshot(state.sessionId, 6);
		// Old path: was deleted — should have existed=true with content
		const oldEntry = rows.find((r) => r.path === "old-name.ts");
		expect(oldEntry).toBeDefined();
		expect(oldEntry?.existed).toBe(true);
		expect(oldEntry?.content).not.toBeNull();

		// New path: brand new on disk — should have existed=false
		const newEntry = rows.find((r) => r.path === "new-name.ts");
		expect(newEntry).toBeDefined();
		expect(newEntry?.existed).toBe(false);

		deleteSnapshot(state.sessionId, 6);
	});

	test("does not affect git status after snapshotting", async () => {
		writeFileSync(join(state.repoDir, "README.md"), "changed\n");

		await takeSnapshot(state.repoDir, state.sessionId, 5);

		// git status should still show the modification — nothing was stashed
		const proc = Bun.spawnSync(["git", "status", "--porcelain"], {
			cwd: state.repoDir,
			stdout: "pipe",
			stderr: "pipe",
		});
		const statusOut = proc.stdout.toString();
		expect(statusOut).toContain("README.md");

		deleteSnapshot(state.sessionId, 5);
	});
});

// ─── restoreSnapshot ──────────────────────────────────────────────────────────

describe("restoreSnapshot", () => {
	const state = useTestRepo();

	test("returns not-found when no snapshot exists", async () => {
		const result = await restoreSnapshot(state.repoDir, state.sessionId, 99);
		expect(result.restored).toBe(false);
		if (!result.restored) expect(result.reason).toBe("not-found");
	});

	test("restores a modified file to its pre-turn content", async () => {
		const filePath = join(state.repoDir, "README.md");
		const originalContent = "hello\n";
		// File was already "hello\n" from makeRepo; now simulate a pre-turn snapshot
		saveSnapshot(state.sessionId, 10, [
			{
				path: "README.md",
				content: new TextEncoder().encode(originalContent),
				existed: true,
			},
		]);

		// Agent modifies the file
		writeFileSync(filePath, "agent changed this\n");

		// Undo: restore
		const result = await restoreSnapshot(state.repoDir, state.sessionId, 10);
		expect(result.restored).toBe(true);

		const restoredContent = await Bun.file(filePath).text();
		expect(restoredContent).toBe(originalContent);

		// Snapshot should be cleaned up
		expect(loadSnapshot(state.sessionId, 10)).toHaveLength(0);
	});

	test("deletes a file that was created by the agent (existed=false)", async () => {
		const newFile = join(state.repoDir, "agent-created.ts");
		writeFileSync(newFile, "export const x = 1;\n");

		// Snapshot says this file did NOT exist before the turn
		saveSnapshot(state.sessionId, 11, [
			{ path: "agent-created.ts", content: null, existed: false },
		]);

		const result = await restoreSnapshot(state.repoDir, state.sessionId, 11);
		expect(result.restored).toBe(true);

		const exists = await Bun.file(newFile).exists();
		expect(exists).toBe(false);

		expect(loadSnapshot(state.sessionId, 11)).toHaveLength(0);
	});

	test("end-to-end: takeSnapshot then agent creates file, restoreSnapshot deletes it", async () => {
		// Working tree is clean before the turn — nothing to snapshot
		const snapped = await takeSnapshot(state.repoDir, state.sessionId, 12);
		expect(snapped).toBe(false);

		// Agent creates a new file mid-turn
		const agentFile = join(state.repoDir, "generated.ts");
		writeFileSync(agentFile, "export const y = 2;\n");

		// Now snapshot captures the untracked file with existed=false
		const snapped2 = await takeSnapshot(state.repoDir, state.sessionId, 13);
		expect(snapped2).toBe(true);

		const rows = loadSnapshot(state.sessionId, 13);
		const entry = rows.find((r) => r.path === "generated.ts");
		expect(entry?.existed).toBe(false);

		// Restore: should delete the agent-created file
		const result = await restoreSnapshot(state.repoDir, state.sessionId, 13);
		expect(result.restored).toBe(true);
		expect(await Bun.file(agentFile).exists()).toBe(false);
	});
});
