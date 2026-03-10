import { copyFileSync, existsSync, mkdirSync, symlinkSync } from "node:fs";
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
function copyFileIfMissing(source: string, destination: string): void {
	if (!existsSync(source) || existsSync(destination)) return;
	mkdirSync(dirname(destination), { recursive: true });
	copyFileSync(source, destination);
}

function linkDirectoryIfMissing(source: string, destination: string): void {
	if (!existsSync(source) || existsSync(destination)) return;
	mkdirSync(dirname(destination), { recursive: true });
	symlinkSync(
		source,
		destination,
		process.platform === "win32" ? "junction" : "dir",
	);
}

export async function initializeWorktree(
	mainCwd: string,
	worktreeCwd: string,
): Promise<void> {
	const [mainRoot, worktreeRoot] = await Promise.all([
		getRepoRoot(mainCwd),
		getRepoRoot(worktreeCwd),
	]);
	if (!existsSync(join(mainRoot, "package.json"))) return;

	for (const lockfile of ["bun.lock", "bun.lockb"]) {
		copyFileIfMissing(join(mainRoot, lockfile), join(worktreeRoot, lockfile));
	}

	linkDirectoryIfMissing(
		join(mainRoot, "node_modules"),
		join(worktreeRoot, "node_modules"),
	);
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

type MergeWorktreeResult =
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
