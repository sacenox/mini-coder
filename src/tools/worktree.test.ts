import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	lstatSync,
	mkdirSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	cleanupBranch,
	createWorktree,
	hasDirtyWorkingTree,
	initializeWorktree,
	isGitRepo,
	MergeInProgressError,
	mergeWorktree,
	removeWorktree,
	syncDirtyStateToWorktree,
} from "./worktree.ts";

function git(cwd: string, args: string[]): string {
	const proc = Bun.spawnSync(["git", ...args], {
		cwd,
		stdout: "pipe",
		stderr: "pipe",
	});
	if (proc.exitCode !== 0) {
		throw new Error(`git ${args.join(" ")} failed: ${proc.stderr.toString()}`);
	}
	return proc.stdout.toString().trim();
}

function gitStatusLines(cwd: string): string[] {
	const output = git(cwd, ["status", "--porcelain", "-u"]);
	if (!output) return [];
	return output
		.split("\n")
		.filter((line) => line.length > 0)
		.sort();
}

function makeRepo(): string {
	const dir = join(
		tmpdir(),
		`mc-worktree-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	mkdirSync(dir, { recursive: true });
	git(dir, ["init"]);
	git(dir, ["config", "user.email", "test@example.com"]);
	git(dir, ["config", "user.name", "Test"]);
	writeFileSync(join(dir, "README.md"), "hello\n");
	git(dir, ["add", "README.md"]);
	git(dir, ["commit", "-m", "init"]);
	return dir;
}

describe("worktree helpers", () => {
	let repoDir = "";
	const extraDirs: string[] = [];

	beforeEach(() => {
		repoDir = makeRepo();
	});

	afterEach(() => {
		for (const dir of extraDirs.splice(0)) {
			rmSync(dir, { recursive: true, force: true });
		}
		rmSync(repoDir, { recursive: true, force: true });
	});

	function makeWorktreeDir(name: string) {
		const branch = `mc-sub-${name}-${Date.now()}`;
		const wtPath = join(
			tmpdir(),
			`mc-wt-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
		);
		extraDirs.push(wtPath);
		return { branch, wtPath };
	}

	test("detects git and non-git directories", async () => {
		expect(await isGitRepo(repoDir)).toBe(true);

		const nonGit = join(
			tmpdir(),
			`mc-worktree-nongit-${Date.now()}-${Math.random().toString(36).slice(2)}`,
		);
		extraDirs.push(nonGit);
		mkdirSync(nonGit, { recursive: true });
		expect(await isGitRepo(nonGit)).toBe(false);
	});

	test("detects dirty working tree state", async () => {
		expect(await hasDirtyWorkingTree(repoDir)).toBe(false);

		writeFileSync(join(repoDir, "untracked.txt"), "dirty\n");
		expect(await hasDirtyWorkingTree(repoDir)).toBe(true);
	});

	test("syncs dirty tracked, staged, and untracked state into worktree", async () => {
		const { branch, wtPath } = makeWorktreeDir("dirty");

		await createWorktree(repoDir, branch, wtPath);

		writeFileSync(join(repoDir, "README.md"), "tracked but unstaged\n");
		writeFileSync(join(repoDir, "staged.txt"), "staged file\n");
		git(repoDir, ["add", "staged.txt"]);
		writeFileSync(join(repoDir, "untracked.txt"), "untracked file\n");

		await syncDirtyStateToWorktree(repoDir, wtPath);

		expect(await Bun.file(join(wtPath, "README.md")).text()).toBe(
			"tracked but unstaged\n",
		);
		expect(await Bun.file(join(wtPath, "staged.txt")).text()).toBe(
			"staged file\n",
		);
		expect(await Bun.file(join(wtPath, "untracked.txt")).text()).toBe(
			"untracked file\n",
		);
		expect(gitStatusLines(wtPath)).toEqual(gitStatusLines(repoDir));

		await removeWorktree(repoDir, wtPath);
		await cleanupBranch(repoDir, branch);
	});

	test("initializes bun dependencies in worktree", async () => {
		const { branch, wtPath } = makeWorktreeDir("init");

		writeFileSync(join(repoDir, "package.json"), "{}\n");
		writeFileSync(join(repoDir, "bun.lock"), "lock\n");
		mkdirSync(join(repoDir, "node_modules", "bun-types"), { recursive: true });
		writeFileSync(
			join(repoDir, "node_modules", "bun-types", "index.d.ts"),
			"\n",
		);

		await createWorktree(repoDir, branch, wtPath);
		await initializeWorktree(repoDir, wtPath);

		expect(await Bun.file(join(wtPath, "bun.lock")).text()).toBe("lock\n");
		expect(realpathSync(join(wtPath, "node_modules"))).toBe(
			realpathSync(join(repoDir, "node_modules")),
		);
		expect(lstatSync(join(wtPath, "node_modules")).isSymbolicLink()).toBe(true);

		await removeWorktree(repoDir, wtPath);
		await cleanupBranch(repoDir, branch);
	});

	test("creates a worktree and merges successfully", async () => {
		const { branch, wtPath } = makeWorktreeDir("1");

		await createWorktree(repoDir, branch, wtPath);
		writeFileSync(join(wtPath, "feature.txt"), "from branch\n");
		git(wtPath, ["add", "feature.txt"]);
		git(wtPath, ["commit", "-m", "feature"]);

		const merge = await mergeWorktree(repoDir, branch);
		expect(merge).toEqual({ success: true });
		expect(await Bun.file(join(repoDir, "feature.txt")).text()).toBe(
			"from branch\n",
		);

		await removeWorktree(repoDir, wtPath);
		await cleanupBranch(repoDir, branch);
	});

	test("returns conflict files when merge conflicts", async () => {
		const { branch, wtPath } = makeWorktreeDir("2");

		await createWorktree(repoDir, branch, wtPath);

		writeFileSync(join(repoDir, "README.md"), "main change\n");
		git(repoDir, ["commit", "-am", "main change"]);

		writeFileSync(join(wtPath, "README.md"), "branch change\n");
		git(wtPath, ["commit", "-am", "branch change"]);

		const merge = await mergeWorktree(repoDir, branch);
		expect(merge.success).toBe(false);
		if (!merge.success) {
			expect(merge.conflictFiles).toContain("README.md");
		}

		git(repoDir, ["merge", "--abort"]);
		await removeWorktree(repoDir, wtPath);
		await cleanupBranch(repoDir, branch);
	});

	test("throws MergeInProgressError when another merge is already in progress", async () => {
		const { branch: branch1, wtPath: wtPath1 } = makeWorktreeDir("3");
		const { branch: branch2, wtPath: wtPath2 } = makeWorktreeDir("4");

		await createWorktree(repoDir, branch1, wtPath1);
		await createWorktree(repoDir, branch2, wtPath2);

		writeFileSync(join(repoDir, "README.md"), "main change\n");
		git(repoDir, ["commit", "-am", "main change"]);

		writeFileSync(join(wtPath1, "README.md"), "branch one\n");
		git(wtPath1, ["commit", "-am", "branch one"]);

		writeFileSync(join(wtPath2, "README.md"), "branch two\n");
		git(wtPath2, ["commit", "-am", "branch two"]);

		const firstMerge = await mergeWorktree(repoDir, branch1);
		expect(firstMerge.success).toBe(false);

		try {
			await mergeWorktree(repoDir, branch2);
			throw new Error("expected mergeWorktree to throw");
		} catch (error) {
			expect(error).toBeInstanceOf(MergeInProgressError);
			if (error instanceof MergeInProgressError) {
				expect(error.conflictFiles).toContain("README.md");
			}
		}

		git(repoDir, ["merge", "--abort"]);
		await removeWorktree(repoDir, wtPath1);
		await removeWorktree(repoDir, wtPath2);
		await cleanupBranch(repoDir, branch1);
		await cleanupBranch(repoDir, branch2);
	});
});
