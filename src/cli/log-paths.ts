import { mkdirSync, readdirSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const LOGS_DIR = join(homedir(), ".config", "mini-coder", "logs");

/** Return the logs directory, creating it if necessary. */
function getLogsDir(): string {
	mkdirSync(LOGS_DIR, { recursive: true });
	return LOGS_DIR;
}

/** Build a PID-scoped log file path: `<logsDir>/<prefix>-<pid>.log` */
export function pidLogPath(prefix: string): string {
	return join(getLogsDir(), `${prefix}-${process.pid}.log`);
}

function isProcessAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

const LOG_FILE_RE = /^(api|errors)-(\d+)\.log$/;

/**
 * Remove log files left by dead processes. Called once on startup by
 * the logs directory doesn't grow unbounded.
 */
export function cleanStaleLogs(): void {
	let entries: string[];
	try {
		entries = readdirSync(LOGS_DIR);
	} catch {
		return;
	}

	for (const name of entries) {
		const m = LOG_FILE_RE.exec(name);
		if (!m) continue;
		const pidStr = m[2] as string;
		const pid = Number.parseInt(pidStr, 10);
		if (pid === process.pid) continue;
		if (!isProcessAlive(pid)) {
			try {
				unlinkSync(join(LOGS_DIR, name));
			} catch {
				/* race: another process may have already cleaned it */
			}
		}
	}
}
