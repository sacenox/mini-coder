import {
	chmodSync,
	copyFileSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readlinkSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

interface GitResult {
	stdout: string;
	stderr: string;
	exitCode: number;
}

async function runGit(cwd: string, args: string[]): Promise<GitResult> {
	try {
		const proc = Bun.spawn(["git", ...args], {
			cwd,
			stdout: "pipe",
			stderr: "pipe",
		});
		const [stdout, stderr, exitCode] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
			proc.exited,
		]);
		return { stdout, stderr, exitCode };
	} catch {
		return { stdout: "", stderr: "failed to execute git", exitCode: -1 };
	}
}

function gitError(action: string, detail: string): Error {
	return new Error(`${action}: ${detail || "unknown git error"}`);
}

function splitNonEmptyLines(text: string): string[] {
	return text
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.length > 0);
}

async function listUnmergedFiles(cwd: string): Promise<string[]> {
	const conflictResult = await runGit(cwd, [
		"diff",
		"--name-only",
		"--diff-filter=U",
	]);
	if (conflictResult.exitCode !== 0) return [];
	return splitNonEmptyLines(conflictResult.stdout);
}

async function hasMergeInProgress(cwd: string): Promise<boolean> {
	const mergeHead = await runGit(cwd, [
		"rev-parse",
		"-q",
		"--verify",
		"MERGE_HEAD",
	]);
	return mergeHead.exitCode === 0;
}

export async function isGitRepo(cwd: string): Promise<boolean> {
	const result = await runGit(cwd, ["rev-parse", "--git-dir"]);
	return result.exitCode === 0;
}

export async function hasDirtyWorkingTree(cwd: string): Promise<boolean> {
	const result = await runGit(cwd, ["status", "--porcelain", "-u"]);
	if (result.exitCode !== 0) return true;
	return result.stdout.trim().length > 0;
}

function splitNullSeparated(text: string): string[] {
	return text.split("\0").filter((value) => value.length > 0);
}

async function getRepoRoot(cwd: string): Promise<string> {
	const result = await runGit(cwd, ["rev-parse", "--show-toplevel"]);
	if (result.exitCode !== 0) {
		throw gitError(
			"Failed to resolve repository root",
			(result.stderr || result.stdout).trim(),
		);
	}
	return result.stdout.trim();
}

async function applyPatch(
	cwd: string,
	patch: string,
	args: string[],
): Promise<void> {
	if (patch.trim().length === 0) return;
	const tempDir = mkdtempSync(join(tmpdir(), "mc-worktree-patch-"));
	const patchPath = join(tempDir, "changes.patch");
	try {
		writeFileSync(patchPath, patch);
		const result = await runGit(cwd, ["apply", ...args, patchPath]);
		if (result.exitCode !== 0) {
			throw gitError(
				"Failed to apply dirty-state patch to worktree",
				(result.stderr || result.stdout).trim(),
			);
		}
	} finally {
		rmSync(tempDir, { recursive: true, force: true });
	}
}

function copyUntrackedPath(source: string, destination: string): void {
	const stat = lstatSync(source);
	mkdirSync(dirname(destination), { recursive: true });
	if (stat.isSymbolicLink()) {
		rmSync(destination, { recursive: true, force: true });
		symlinkSync(readlinkSync(source), destination);
		return;
	}
	copyFileSync(source, destination);
	chmodSync(destination, stat.mode);
}

export async function syncDirtyStateToWorktree(
	mainCwd: string,
	worktreeCwd: string,
): Promise<void> {
	const [staged, unstaged, untracked, mainRoot, worktreeRoot] =
		await Promise.all([
			runGit(mainCwd, ["diff", "--binary", "--cached"]),
			runGit(mainCwd, ["diff", "--binary"]),
			runGit(mainCwd, ["ls-files", "--others", "--exclude-standard", "-z"]),
			getRepoRoot(mainCwd),
			getRepoRoot(worktreeCwd),
		]);
	if (staged.exitCode !== 0) {
		throw gitError(
			"Failed to read staged changes",
			(staged.stderr || staged.stdout).trim(),
		);
	}
	if (unstaged.exitCode !== 0) {
		throw gitError(
			"Failed to read unstaged changes",
			(unstaged.stderr || unstaged.stdout).trim(),
		);
	}
	if (untracked.exitCode !== 0) {
		throw gitError(
			"Failed to list untracked files",
			(untracked.stderr || untracked.stdout).trim(),
		);
	}

	await applyPatch(worktreeRoot, staged.stdout, ["--index"]);
	await applyPatch(worktreeRoot, unstaged.stdout, []);

	for (const relPath of splitNullSeparated(untracked.stdout)) {
		copyUntrackedPath(join(mainRoot, relPath), join(worktreeRoot, relPath));
	}
}

export async function createWorktree(
	mainCwd: string,
	branch: string,
	path: string,
): Promise<string> {
	const result = await runGit(mainCwd, ["worktree", "add", path, "-b", branch]);
	if (result.exitCode !== 0) {
		throw gitError(
			`Failed to create worktree for branch "${branch}"`,
			(result.stderr || result.stdout).trim(),
		);
	}
	return path;
}

export type MergeWorktreeResult =
	| { success: true }
	| { success: false; conflictFiles: string[] };

export class MergeInProgressError extends Error {
	readonly conflictFiles: string[];

	constructor(branch: string, conflictFiles: string[]) {
		super(
			`Cannot merge branch "${branch}" because another merge is already in progress. Resolve it first before merging this branch.`,
		);
		this.name = "MergeInProgressError";
		this.conflictFiles = conflictFiles;
	}
}

export async function mergeWorktree(
	mainCwd: string,
	branch: string,
): Promise<MergeWorktreeResult> {
	if (await hasMergeInProgress(mainCwd)) {
		const conflictFiles = await listUnmergedFiles(mainCwd);
		throw new MergeInProgressError(branch, conflictFiles);
	}

	const merge = await runGit(mainCwd, ["merge", "--no-ff", branch]);
	if (merge.exitCode === 0) return { success: true };

	const conflictFiles = await listUnmergedFiles(mainCwd);
	if (conflictFiles.length > 0) {
		return { success: false, conflictFiles };
	}

	throw gitError(
		`Failed to merge branch "${branch}"`,
		(merge.stderr || merge.stdout).trim(),
	);
}

export async function removeWorktree(
	mainCwd: string,
	path: string,
): Promise<void> {
	const result = await runGit(mainCwd, ["worktree", "remove", "--force", path]);
	if (result.exitCode !== 0) {
		throw gitError(
			`Failed to remove worktree "${path}"`,
			(result.stderr || result.stdout).trim(),
		);
	}
}

export async function cleanupBranch(
	mainCwd: string,
	branch: string,
): Promise<void> {
	const result = await runGit(mainCwd, ["branch", "-D", branch]);
	if (result.exitCode !== 0) {
		throw gitError(
			`Failed to delete branch "${branch}"`,
			(result.stderr || result.stdout).trim(),
		);
	}
}
