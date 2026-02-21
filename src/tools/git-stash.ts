/**
 * Git-based turn snapshots for /undo.
 *
 * Before each agent turn we stash any dirty working tree so that /undo can
 * restore files to exactly the state they were in before the agent ran.
 *
 * Both functions are silent no-ops when the cwd is not inside a git repository
 * or the working tree is already clean. They never throw.
 */

/** Stash the current working tree before a turn. Returns true if a stash was created. */
export async function gitStashTurn(
	cwd: string,
	turnIndex: number,
): Promise<boolean> {
	try {
		const proc = Bun.spawn(
			[
				"git",
				"stash",
				"push",
				"--include-untracked",
				"--message",
				`mini-coder:turn:${turnIndex}`,
			],
			{ cwd, stdout: "pipe", stderr: "pipe" },
		);
		// Drain both streams so the process doesn't hang
		await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
		]);
		const code = await proc.exited;
		// Exit 0 = stash created; exit 1 = "nothing to stash" (also fine)
		// Any other code means git isn't available or cwd is not a repo
		return code === 0;
	} catch {
		return false;
	}
}

export type GitStashPopResult =
	| { restored: true }
	| { restored: false; conflict: boolean };

/**
 * Pop the mini-coder stash for a specific turn.
 * Returns whether files were restored and whether a merge conflict occurred.
 */
export async function gitStashPop(
	cwd: string,
	turnIndex: number,
): Promise<GitStashPopResult> {
	const noRestore: GitStashPopResult = { restored: false, conflict: false };
	try {
		// Find the stash for this specific turn
		const listProc = Bun.spawn(["git", "stash", "list"], {
			cwd,
			stdout: "pipe",
			stderr: "pipe",
		});
		const listOut = await new Response(listProc.stdout).text();
		await new Response(listProc.stderr).text();
		await listProc.exited;

		const pattern = new RegExp(
			`^(stash@\\{\\d+\\}):.*mini-coder:turn:${turnIndex}$`,
			"m",
		);
		const match = pattern.exec(listOut);
		if (!match) return noRestore;

		const ref = match[1];
		if (!ref) return noRestore;

		const popProc = Bun.spawn(["git", "stash", "pop", ref], {
			cwd,
			stdout: "pipe",
			stderr: "pipe",
		});
		await Promise.all([
			new Response(popProc.stdout).text(),
			new Response(popProc.stderr).text(),
		]);
		const code = await popProc.exited;

		if (code === 0) return { restored: true };
		// Non-zero exit from stash pop typically means a merge conflict
		return { restored: false, conflict: true };
	} catch {
		return noRestore;
	}
}
