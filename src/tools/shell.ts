import { z } from "zod";
import { restoreTerminal } from "../cli/output.ts";
import { stripAnsi } from "../internal/ansi.ts";
import { buildFileEditShellPrelude } from "../internal/file-edit/command.ts";
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
};

export interface ShellOutput {
	stdout: string;
	stderr: string;
	exitCode: number;
	success: boolean;
	timedOut: boolean;
	/** Raw stdout with ANSI escape codes preserved (for user display). */
	rawStdout?: string | undefined;
	/** Raw stderr with ANSI escape codes preserved (for user display). */
	rawStderr?: string | undefined;
}

const MAX_OUTPUT_BYTES = 10_000; // 10KB per stream

export async function runShellCommand(input: ShellInput): Promise<ShellOutput> {
	const cwd = input.cwd ?? process.cwd();
	const timeout = input.timeout ?? 30_000;
	const env: Record<string, string | undefined> = Object.assign(
		{},
		process.env as Record<string, string | undefined>,
		{ FORCE_COLOR: "1" },
		input.env ?? {},
	);

	let timedOut = false;
	const readers: { cancel: () => Promise<void> }[] = [];
	const wasRaw = process.stdin.isTTY ? process.stdin.isRaw : false;

	const proc = Bun.spawn(
		["bash", "-c", `${buildFileEditShellPrelude()}\n${input.command}`],
		{
			cwd,
			env,
			stdout: "pipe",
			stderr: "pipe",
		},
	);

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
		for (const reader of readers) {
			reader.cancel().catch(() => {});
		}
	}, timeout);

	async function collectStream(
		stream: ReadableStream<Uint8Array>,
	): Promise<string> {
		const reader = stream.getReader();
		readers.push(reader);
		const chunks: Uint8Array[] = [];
		let totalBytes = 0;
		let truncated = false;

		while (true) {
			try {
				const { done, value } = await reader.read();
				if (done) break;
				if (!value) continue;

				if (totalBytes + value.length > MAX_OUTPUT_BYTES) {
					chunks.push(value.slice(0, MAX_OUTPUT_BYTES - totalBytes));
					truncated = true;
					reader.cancel().catch(() => {});
					break;
				}

				chunks.push(value);
				totalBytes += value.length;
			} catch {
				break;
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
		restoreTerminal();
		if (wasRaw) {
			try {
				process.stdin.setRawMode(true);
			} catch {
				/* ignore */
			}
		}
	}

	const rawOut = stdout.trimEnd();
	const rawErr = stderr.trimEnd();
	const hasAnsi = rawOut.includes("\x1b[") || rawErr.includes("\x1b[");
	return {
		stdout: hasAnsi ? stripAnsi(rawOut) : rawOut,
		stderr: hasAnsi ? stripAnsi(rawErr) : rawErr,
		exitCode,
		success: exitCode === 0,
		timedOut,
		rawStdout: hasAnsi ? rawOut : undefined,
		rawStderr: hasAnsi ? rawErr : undefined,
	};
}

export const shellTool: ToolDef<ShellInput, ShellOutput> = {
	name: "shell",
	description:
		"Execute a shell command. Returns stdout, stderr, and exit code. " +
		"Use this for reading/searching code, running tests, builds, git commands, and invoking `mc-edit` for partial file edits. " +
		"Prefer non-interactive commands. Avoid commands that run indefinitely.",
	schema: ShellSchema,
	execute: runShellCommand,
};
