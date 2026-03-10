import type { SubagentOutput, SubagentSummary } from "../tools/subagent.ts";
import {
	cleanupBranch,
	MergeInProgressError,
	mergeWorktree,
} from "../tools/worktree.ts";

/**
 * Resolve the command to invoke a new `mc` subprocess.
 * - Dev:  process.argv[1] ends with ".ts" → [bun, script]
 * - Prod: compiled binary → [process.execPath]
 */
function getMcCommand(): string[] {
	const script = process.argv[1];
	if (script?.endsWith(".ts")) {
		return [process.execPath, script];
	}
	return [process.execPath];
}

// Loose recursion cap passed via environment so subprocess chains are bounded
// without an in-process depth parameter. Generous enough for real use-cases.
const MAX_SUBAGENT_DEPTH = 10;

export function createSubagentRunner(
	cwd: string,
	getCurrentModel: () => string,
) {
	// Active subprocesses — maps pid to branch name (if any) for interrupt cleanup.
	const activeProcs = new Map<number, string | undefined>();

	// Depth is injected by the parent subprocess via MC_SUBAGENT_DEPTH env var.
	const subagentDepth = parseInt(process.env.MC_SUBAGENT_DEPTH ?? "0", 10);

	// Merge lock: serialises merge operations from concurrent subagents.
	let mergeLockTail = Promise.resolve();

	const mergeSubagentBranch = async (
		branch: string,
	): Promise<{ mergeConflicts?: string[] }> => {
		const prev = mergeLockTail;
		let releaseLock!: () => void;
		mergeLockTail = new Promise((resolve) => {
			releaseLock = resolve;
		});
		try {
			await prev;
			const result = await mergeWorktree(cwd, branch);
			if (result.success) {
				await cleanupBranch(cwd, branch);
				return {};
			}
			// Merge produced conflicts — leave branch for user to resolve.
			return { mergeConflicts: result.conflictFiles };
		} catch (err) {
			if (err instanceof MergeInProgressError) {
				// Another merge is in progress — return its conflict files.
				return { mergeConflicts: err.conflictFiles };
			}
			throw err;
		} finally {
			releaseLock();
		}
	};

	const runSubagent = async (
		prompt: string,
		agentName?: string,
		modelOverride?: string,
		_parentLabel?: string,
	): Promise<SubagentOutput> => {
		if (subagentDepth >= MAX_SUBAGENT_DEPTH) {
			throw new Error(
				`Subagent recursion limit reached (depth ${subagentDepth}). ` +
					`Cannot spawn another subagent.`,
			);
		}

		const model = modelOverride ?? getCurrentModel();
		// Parent generates the branch name so it can clean it up on interrupt.
		const laneId = crypto.randomUUID().slice(0, 8);
		const worktreeBranch = `mc-sub-${laneId}`;
		const cmd = [
			...getMcCommand(),
			"--subagent",
			"--cwd",
			cwd,
			"--model",
			model,
			"--output-fd",
			"3",
			"--worktree-branch",
			worktreeBranch,
			...(agentName ? ["--agent", agentName] : []),
			prompt,
		];

		const proc = Bun.spawn({
			cmd,
			env: {
				...process.env,
				MC_SUBAGENT_DEPTH: String(subagentDepth + 1),
			},
			stdio: ["ignore", "inherit", "inherit", "pipe"],
		});

		activeProcs.set(proc.pid, worktreeBranch);
		try {
			const [text] = await Promise.all([
				Bun.file(proc.stdio[3] as unknown as number).text(),
				proc.exited,
			]);

			const trimmed = text.trim();
			if (!trimmed) {
				throw new Error(
					`Subagent subprocess produced no output (exit code ${String(proc.exitCode)})`,
				);
			}

			let parsed: SubagentSummary & { error?: string };
			try {
				parsed = JSON.parse(trimmed) as SubagentSummary & { error?: string };
			} catch {
				throw new Error(
					`Subagent subprocess wrote non-JSON output (exit code ${String(proc.exitCode)}): ${trimmed.slice(0, 200)}`,
				);
			}

			if (parsed.error) {
				throw new Error(`Subagent failed: ${parsed.error}`);
			}
			if (proc.exitCode !== 0) {
				throw new Error(
					`Subagent process exited with code ${String(proc.exitCode)}`,
				);
			}

			const output: SubagentOutput = {
				result: parsed.result,
				inputTokens: parsed.inputTokens,
				outputTokens: parsed.outputTokens,
			};

			if (parsed.worktreeBranch) {
				const mergeResult = await mergeSubagentBranch(parsed.worktreeBranch);
				if (mergeResult.mergeConflicts) {
					output.mergeConflicts = mergeResult.mergeConflicts;
				}
			}

			return output;
		} finally {
			activeProcs.delete(proc.pid);
		}
	};

	return {
		runSubagent,
		killAll: () => {
			for (const [pid, branch] of activeProcs) {
				try {
					process.kill(pid, "SIGTERM");
				} catch {
					// Process may have already exited.
				}
				if (branch) {
					// Best-effort: delete the orphan branch the subprocess left behind.
					cleanupBranch(cwd, branch).catch(() => {});
				}
			}
		},
	};
}
