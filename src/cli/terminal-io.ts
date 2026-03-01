export type SignalHandler = () => void;

export class TerminalIO {
	private cleanupHandlers: Set<() => void> = new Set();
	private rawModeEnabled = false;
	private abortController = new AbortController();

	stdoutWrite(text: string): void {
		process.stdout.write(text);
	}

	stderrWrite(text: string): void {
		process.stderr.write(text);
	}

	get isTTY(): boolean {
		return process.stdin.isTTY;
	}

	setRawMode(enable: boolean): void {
		if (this.isTTY) {
			process.stdin.setRawMode(enable);
			this.rawModeEnabled = enable;
		}
	}

	restoreTerminal(): void {
		try {
			this.stderrWrite("\x1B[?25h");
			this.stderrWrite("\r\x1B[2K");
		} catch {
			/* ignore */
		}
		try {
			if (this.rawModeEnabled) {
				this.setRawMode(false);
			}
		} catch {
			/* ignore */
		}
	}

	registerCleanup(): void {
		const cleanup = () => this.restoreTerminal();
		process.on("exit", cleanup);
		process.on("SIGTERM", () => {
			cleanup();
			process.exit(143);
		});
		process.on("SIGINT", () => {
			cleanup();
			process.exit(130);
		});
		process.on("uncaughtException", (err) => {
			cleanup();
			throw err;
		});
		process.on("unhandledRejection", (reason) => {
			cleanup();
			throw reason instanceof Error ? reason : new Error(String(reason));
		});
	}

	onStdinData(handler: (data: Buffer) => void): () => void {
		process.stdin.on("data", handler);
		return () => process.stdin.off("data", handler);
	}
}

export const terminal = new TerminalIO();
