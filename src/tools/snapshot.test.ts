import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	deleteSnapshot,
	loadSnapshot,
	saveSnapshot,
} from "../session/db/index.ts";
import { restoreSnapshot, snapshotBeforeEdit } from "./snapshot.ts";

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

// ─── snapshotBeforeEdit ───────────────────────────────────────────────────────

describe("snapshotBeforeEdit", () => {
	const state = useTestRepo();

	test("snapshots a modified tracked file before edit", async () => {
		const filePath = join(state.repoDir, "README.md");
		const snappedPaths = new Set<string>();

		await snapshotBeforeEdit(
			state.repoDir,
			state.sessionId,
			3,
			filePath,
			snappedPaths,
		);

		const rows = loadSnapshot(state.sessionId, 3);
		const readme = rows.find((r) => r.path === "README.md");
		expect(readme).toBeDefined();
		expect(readme?.existed).toBe(true);
		expect(new TextDecoder().decode(readme?.content ?? undefined)).toBe(
			"hello\n",
		);
		expect(snappedPaths.has("README.md")).toBe(true);

		deleteSnapshot(state.sessionId, 3);
	});

	test("snapshots an untracked new file with existed=false", async () => {
		const filePath = join(state.repoDir, "untracked.txt");
		const snappedPaths = new Set<string>();

		await snapshotBeforeEdit(
			state.repoDir,
			state.sessionId,
			4,
			filePath,
			snappedPaths,
		);

		const rows = loadSnapshot(state.sessionId, 4);
		const f = rows.find((r) => r.path === "untracked.txt");
		expect(f).toBeDefined();
		// File didn't exist before edit
		expect(f?.existed).toBe(false);
		expect(f?.content).toBeNull();

		deleteSnapshot(state.sessionId, 4);
	});

	test("does not snapshot the same file twice in one turn", async () => {
		const filePath = join(state.repoDir, "README.md");
		const snappedPaths = new Set<string>();

		await snapshotBeforeEdit(
			state.repoDir,
			state.sessionId,
			5,
			filePath,
			snappedPaths,
		);

		// Change the file
		writeFileSync(filePath, "changed\n");

		// Second call should be a no-op
		await snapshotBeforeEdit(
			state.repoDir,
			state.sessionId,
			5,
			filePath,
			snappedPaths,
		);

		const rows = loadSnapshot(state.sessionId, 5);
		const readme = rows.find((r) => r.path === "README.md");
		expect(new TextDecoder().decode(readme?.content ?? undefined)).toBe(
			"hello\n",
		);

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
		saveSnapshot(state.sessionId, 10, [
			{
				path: "README.md",
				content: new TextEncoder().encode(originalContent),
				existed: true,
			},
		]);

		writeFileSync(filePath, "agent changed this\n");

		const result = await restoreSnapshot(state.repoDir, state.sessionId, 10);
		expect(result.restored).toBe(true);

		const restoredContent = await Bun.file(filePath).text();
		expect(restoredContent).toBe(originalContent);

		expect(loadSnapshot(state.sessionId, 10)).toHaveLength(0);
	});

	test("deletes a file that was created by the agent (existed=false)", async () => {
		const newFile = join(state.repoDir, "agent-created.ts");
		writeFileSync(newFile, "export const x = 1;\n");

		saveSnapshot(state.sessionId, 11, [
			{ path: "agent-created.ts", content: null, existed: false },
		]);

		const result = await restoreSnapshot(state.repoDir, state.sessionId, 11);
		expect(result.restored).toBe(true);

		const exists = await Bun.file(newFile).exists();
		expect(exists).toBe(false);

		expect(loadSnapshot(state.sessionId, 11)).toHaveLength(0);
	});

	test("end-to-end: snapshotBeforeEdit then agent creates file, restoreSnapshot deletes it", async () => {
		const agentFile = join(state.repoDir, "generated.ts");
		const snappedPaths = new Set<string>();

		await snapshotBeforeEdit(
			state.repoDir,
			state.sessionId,
			13,
			agentFile,
			snappedPaths,
		);

		writeFileSync(agentFile, "export const y = 2;\n");

		const result = await restoreSnapshot(state.repoDir, state.sessionId, 13);
		expect(result.restored).toBe(true);
		expect(await Bun.file(agentFile).exists()).toBe(false);
	});
});
