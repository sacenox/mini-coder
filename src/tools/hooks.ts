import { constants, accessSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// ─── Hook discovery ───────────────────────────────────────────────────────────

function isExecutable(filePath: string): boolean {
	try {
		accessSync(filePath, constants.X_OK);
		return true;
	} catch {
		return false;
	}
}

function findHook(toolName: string, cwd: string): string | null {
	const scriptName = `post-${toolName}`;
	const candidates = [
		join(cwd, ".agents", "hooks", scriptName),
		join(homedir(), ".agents", "hooks", scriptName),
	];
	for (const p of candidates) {
		if (isExecutable(p)) return p;
	}
	return null;
}

/**
 * Resolve all hook scripts for the given tool names once at session start.
 * Returns a lookup function that is O(1) per call with no further filesystem access.
 */
export function createHookCache(
	toolNames: string[],
	cwd: string,
): (toolName: string) => string | null {
	const cache = new Map<string, string | null>();
	for (const name of toolNames) {
		cache.set(name, findHook(name, cwd));
	}
	return (toolName: string) => cache.get(toolName) ?? null;
}

// ─── Hook execution ───────────────────────────────────────────────────────────

/**
 * Run a hook script with the given env vars.
 * The script inherits the full process environment plus the provided vars.
 * All errors and output are silently swallowed — hooks must never crash the agent.
 */
export async function runHook(
	scriptPath: string,
	env: Record<string, string>,
	cwd: string,
): Promise<boolean> {
	try {
		const proc = Bun.spawn(["bash", scriptPath], {
			cwd,
			env: { ...process.env, ...env },
			stdout: "ignore",
			stderr: "ignore",
		});
		const code = await proc.exited;
		return code === 0;
	} catch {
		// Hooks must not crash the agent
		return false;
	}
}

// ─── Env builders (one per tool) ─────────────────────────────────────────────

export function hookEnvForCreate(
	result: { path: string; diff: string; created: boolean },
	cwd: string,
): Record<string, string> {
	return {
		TOOL: "create",
		FILEPATH: result.path,
		DIFF: result.diff,
		CREATED: String(result.created),
		CWD: cwd,
	};
}

export function hookEnvForReplace(
	result: { path: string; diff: string; deleted: boolean },
	cwd: string,
): Record<string, string> {
	return {
		TOOL: "replace",
		FILEPATH: result.path,
		DIFF: result.diff,
		DELETED: String(result.deleted),
		CWD: cwd,
	};
}

export function hookEnvForInsert(
	result: { path: string; diff: string },
	cwd: string,
): Record<string, string> {
	return {
		TOOL: "insert",
		FILEPATH: result.path,
		DIFF: result.diff,
		CWD: cwd,
	};
}

export function hookEnvForShell(
	result: {
		stdout: string;
		stderr: string;
		exitCode: number;
		timedOut: boolean;
	},
	input: { command: string },
	cwd: string,
): Record<string, string> {
	return {
		TOOL: "shell",
		COMMAND: input.command,
		EXIT_CODE: String(result.exitCode),
		TIMED_OUT: String(result.timedOut),
		STDOUT: result.stdout,
		STDERR: result.stderr,
		CWD: cwd,
	};
}

export function hookEnvForGlob(
	input: { pattern: string },
	cwd: string,
): Record<string, string> {
	return {
		TOOL: "glob",
		PATTERN: input.pattern,
		CWD: cwd,
	};
}

export function hookEnvForGrep(
	input: { pattern: string },
	cwd: string,
): Record<string, string> {
	return {
		TOOL: "grep",
		PATTERN: input.pattern,
		CWD: cwd,
	};
}

export function hookEnvForRead(
	input: { path: string },
	cwd: string,
): Record<string, string> {
	return {
		TOOL: "read",
		FILEPATH: input.path,
		CWD: cwd,
	};
}
