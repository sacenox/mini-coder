import { z } from "zod";
import { restoreTerminal } from "../cli/output.ts";
import type { ToolDef } from "../llm-api/types.ts";

const ShellSchema = z.object({
	command: z.string().describe("Shell command to execute"),
	timeout: z
		.number()
		.int()
		.min(1000)
		.max(300_000)
		.optional()
		.default(30_000)
		.describe("Timeout in milliseconds (default: 30s, max: 5min)"),
	env: z
		.record(z.string(), z.string())
		.optional()
		.describe("Additional environment variables to set"),
});

type ShellInput = z.infer<typeof ShellSchema> & {
	cwd?: string;
	onOutput?: (chunk: string) => void;
};

export interface ShellOutput {
	stdout: string;
	stderr: string;
	exitCode: number;
	success: boolean;
	timedOut: boolean;
	streamedOutput: boolean;
}

const MAX_OUTPUT_BYTES = 10_000; // 10KB per stream

export const shellTool: ToolDef<ShellInput, ShellOutput> = {
	name: "shell",
	description:
		"Execute a shell command. Returns stdout, stderr, and exit code. " +
		"Use this for running tests, builds, git commands, and other CLI operations. " +
		"Prefer non-interactive commands. Avoid commands that run indefinitely.",
	schema: ShellSchema,
	execute: async (input) => {
		const cwd = input.cwd ?? process.cwd();
		const timeout = input.timeout ?? 30_000;
		const env: Record<string, string | undefined> = Object.assign(
			{},
			process.env as Record<string, string | undefined>,
			input.env ?? {},
		);

		let timedOut = false;
		const readers: { cancel: () => Promise<void> }[] = [];

		const wasRaw = process.stdin.isTTY ? process.stdin.isRaw : false;

		const proc = Bun.spawn(["bash", "-c", input.command], {
			cwd,
			env,
			stdout: "pipe",
			stderr: "pipe",
		});

		// Set up timeout
		const timer = setTimeout(() => {
			timedOut = true;
			try {
				proc.kill("SIGTERM");
				setTimeout(() => {
					try {
						proc.kill("SIGKILL");
					} catch {
						/* already dead */
					}
				}, 2000);
			} catch {
				/* already done */
			}
			for (const r of readers) {
				r.cancel().catch(() => {});
			}
		}, timeout);

		// Collect output with size limit; forward each decoded chunk to onOutput.
		async function collectStream(
			stream: ReadableStream<Uint8Array>,
			onChunk?: (text: string) => void,
		): Promise<string> {
			const reader = stream.getReader();
			readers.push(reader);
			const chunks: Uint8Array[] = [];
			let totalBytes = 0;
			let truncated = false;
			const decoder = new TextDecoder();

			while (true) {
				try {
					const { done, value } = await reader.read();
					if (done) break;
					if (value) {
						onChunk?.(decoder.decode(value, { stream: true }));
						if (totalBytes + value.length > MAX_OUTPUT_BYTES) {
							chunks.push(value.slice(0, MAX_OUTPUT_BYTES - totalBytes));
							truncated = true;
							reader.cancel().catch(() => {});
							break;
						}
						chunks.push(value);
						totalBytes += value.length;
					}
				} catch (_err) {
					// Reader was cancelled or stream errored
					break;
				}
			}

			const text = Buffer.concat(chunks).toString("utf-8");
			return truncated ? `${text}\n[output truncated]` : text;
		}

		let stdout = "";
		let stderr = "";
		let exitCode = 1;
		const onOutput = input.onOutput;
		const hasOutputHandler = typeof onOutput === "function";
		let streamedAnyOutput = false;
		let streamedEndsWithNewline = true;
		const emitOutput = (chunk: string): void => {
			if (!chunk || !hasOutputHandler) return;
			streamedAnyOutput = true;
			streamedEndsWithNewline = /[\r\n]$/.test(chunk);
			onOutput(chunk);
		};

		try {
			[stdout, stderr] = await Promise.all([
				collectStream(proc.stdout, hasOutputHandler ? emitOutput : undefined),
				collectStream(proc.stderr, hasOutputHandler ? emitOutput : undefined),
			]);
			if (streamedAnyOutput && !streamedEndsWithNewline) {
				emitOutput("\n");
			}

			exitCode = await proc.exited;
		} finally {
			clearTimeout(timer);
			// Ensure the terminal is in a sane state if the spawn caused any
			// raw-mode or cursor-visibility side-effects
			restoreTerminal();
			if (wasRaw) {
				try {
					process.stdin.setRawMode(true);
				} catch {
					/* ignore */
				}
			}
		}

		return {
			stdout: stdout.trimEnd(),
			stderr: stderr.trimEnd(),
			exitCode,
			success: exitCode === 0,
			timedOut,
			streamedOutput: streamedAnyOutput,
		};
	},
};
