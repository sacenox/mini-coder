import { z } from "zod";
import { restoreTerminal } from "../cli/output.ts";
import type { ToolDef } from "../llm-api/types.ts";

const ShellInput = z.object({
	command: z.string().describe("Shell command to execute"),
	cwd: z
		.string()
		.optional()
		.describe("Working directory for the command (defaults to process.cwd())"),
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

type ShellInput = z.infer<typeof ShellInput>;

export interface ShellOutput {
	stdout: string;
	stderr: string;
	exitCode: number;
	success: boolean;
	timedOut: boolean;
}

const MAX_OUTPUT_BYTES = 100_000; // 100KB per stream

export const shellTool: ToolDef<ShellInput, ShellOutput> = {
	name: "shell",
	description:
		"Execute a shell command. Returns stdout, stderr, and exit code. " +
		"Use this for running tests, builds, git commands, and other CLI operations. " +
		"Prefer non-interactive commands. Avoid commands that run indefinitely.",
	schema: ShellInput,
	execute: async (input) => {
		const cwd = input.cwd ?? process.cwd();
		const timeout = input.timeout ?? 30_000;
		const env: Record<string, string | undefined> = Object.assign(
			{},
			process.env as Record<string, string | undefined>,
			input.env ?? {},
		);

		let timedOut = false;

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
		}, timeout);

		// Collect output with size limit
		async function collectStream(
			stream: ReadableStream<Uint8Array>,
		): Promise<string> {
			const reader = stream.getReader();
			const chunks: Uint8Array[] = [];
			let totalBytes = 0;
			let truncated = false;

			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				if (value) {
					if (totalBytes + value.length > MAX_OUTPUT_BYTES) {
						chunks.push(value.slice(0, MAX_OUTPUT_BYTES - totalBytes));
						truncated = true;
						reader.cancel().catch(() => {});
						break;
					}
					chunks.push(value);
					totalBytes += value.length;
				}
			}

			const text = Buffer.concat(chunks).toString("utf-8");
			return truncated ? `${text}\n[output truncated]` : text;
		}

		let stdout = "";
		let stderr = "";
		let exitCode = 1;

		try {
			[stdout, stderr] = await Promise.all([
				collectStream(proc.stdout),
				collectStream(proc.stderr),
			]);
			exitCode = await proc.exited;
		} finally {
			clearTimeout(timer);
			// Ensure the terminal is in a sane state if the spawn caused any
			// raw-mode or cursor-visibility side-effects
			restoreTerminal();
		}

		return {
			stdout: stdout.trimEnd(),
			stderr: stderr.trimEnd(),
			exitCode,
			success: exitCode === 0,
			timedOut,
		};
	},
};
