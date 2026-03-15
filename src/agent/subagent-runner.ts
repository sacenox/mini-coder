import { resolveProcessScriptPath } from "../internal/runtime/script.ts";
import type { SubagentOutput, SubagentSummary } from "../tools/subagent.ts";

/**
 * Resolve the command to invoke a new `mc` subprocess.
 * - Dev / installed JS: Bun runs a script entrypoint → [bun, script]
 * - Compiled binary: no script entrypoint is available → [process.execPath]
 */
export function resolveMcCommand(
	execPath: string,
	mainModule: string | undefined,
	argv1: string | undefined,
): string[] {
	const script = resolveProcessScriptPath(mainModule, argv1);
	if (script) {
		return [execPath, script];
	}
	return [execPath];
}

function getMcCommand(): string[] {
	return resolveMcCommand(process.execPath, Bun.main, process.argv[1]);
}

// Loose recursion cap passed via environment so subprocess chains are bounded
// without an in-process depth parameter. Generous enough for real use-cases.
const MAX_SUBAGENT_DEPTH = 10;

class TailByteBuffer {
	private readonly ring: Uint8Array;
	private writePos = 0;
	private totalSeen = 0;

	constructor(private readonly maxBytes: number) {
		this.ring = new Uint8Array(Math.max(0, maxBytes));
	}

	push(chunk: Uint8Array): void {
		if (this.maxBytes <= 0 || chunk.length === 0) return;

		let offset = 0;
		while (offset < chunk.length) {
			const remaining = chunk.length - offset;
			const writable = Math.min(this.maxBytes - this.writePos, remaining);
			this.ring.set(chunk.subarray(offset, offset + writable), this.writePos);
			this.writePos = (this.writePos + writable) % this.maxBytes;
			offset += writable;
			this.totalSeen += writable;
		}
	}

	toUint8Array(): Uint8Array {
		if (this.maxBytes <= 0) return new Uint8Array(0);
		const kept = Math.min(this.totalSeen, this.maxBytes);
		if (kept === 0) return new Uint8Array(0);
		if (this.totalSeen <= this.maxBytes) return this.ring.subarray(0, kept);

		const out = new Uint8Array(kept);
		const tailBytes = this.ring.subarray(this.writePos);
		out.set(tailBytes, 0);
		out.set(this.ring.subarray(0, this.writePos), tailBytes.length);
		return out;
	}
}

function tailBytesFromChunks(
	chunks: readonly Uint8Array[],
	maxBytes: number,
): Uint8Array {
	const buffer = new TailByteBuffer(maxBytes);
	for (const chunk of chunks) {
		buffer.push(chunk);
	}
	return buffer.toUint8Array();
}

export function tailTextFromChunks(
	chunks: readonly Uint8Array[],
	maxBytes: number,
): string {
	return new TextDecoder().decode(tailBytesFromChunks(chunks, maxBytes));
}

async function drainTail(
	stream: ReadableStream | null,
	maxBytes = 8192,
): Promise<string> {
	if (!stream) return "";
	const reader = stream.getReader();
	const buffer = new TailByteBuffer(maxBytes);

	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			if (value) {
				buffer.push(value as Uint8Array);
			}
		}
	} finally {
		reader.releaseLock();
	}

	return new TextDecoder().decode(buffer.toUint8Array());
}

function formatSubagentDiagnostics(stdout: string, stderr: string): string {
	const lines = [...stderr.split("\n"), ...stdout.split("\n")]
		.map((line) => line.trim())
		.filter(Boolean);
	if (lines.length === 0) return "";
	const tail = lines.slice(-6).join(" | ");
	return ` (diagnostics: ${tail.slice(0, 300)})`;
}

async function resolveDiagnostics(opts: {
	stdoutTail: Promise<string>;
	stderrTail: Promise<string>;
}): Promise<string> {
	const [stdout, stderr] = await Promise.all([
		opts.stdoutTail,
		opts.stderrTail,
	]);
	return formatSubagentDiagnostics(stdout, stderr);
}

export function createSubagentRunner(
	cwd: string,
	getCurrentModel: () => string,
) {
	// Active subprocesses for interrupt cleanup.
	const activeProcs = new Set<ReturnType<typeof Bun.spawn>>();

	// Depth is injected by the parent subprocess via MC_SUBAGENT_DEPTH env var.
	const subagentDepth = Number.parseInt(
		process.env.MC_SUBAGENT_DEPTH ?? "0",
		10,
	);

	const runSubagent = async (
		prompt: string,
		agentName?: string,
		modelOverride?: string,
		abortSignal?: AbortSignal,
	): Promise<SubagentOutput> => {
		if (subagentDepth >= MAX_SUBAGENT_DEPTH) {
			throw new Error(
				`Subagent recursion limit reached (depth ${subagentDepth}). ` +
					`Cannot spawn another subagent.`,
			);
		}

		if (abortSignal?.aborted) {
			throw new DOMException(
				"Subagent execution was interrupted",
				"AbortError",
			);
		}

		const model = modelOverride ?? getCurrentModel();
		const cmd = [
			...getMcCommand(),
			"--subagent",
			"--cwd",
			cwd,
			"--model",
			model,
			"--output-fd",
			"3",
			...(agentName ? ["--agent", agentName] : []),
			prompt,
		];

		const proc = Bun.spawn({
			cmd,
			env: {
				...process.env,
				MC_SUBAGENT_DEPTH: String(subagentDepth + 1),
			},
			// Keep subagent stdout/stderr isolated so transient tool errors or warnings
			// don't leak into the parent UI. We only surface these streams on failure.
			stdio: ["ignore", "pipe", "pipe", "pipe"],
		});

		activeProcs.add(proc);

		let aborted = false;
		const onAbort = () => {
			aborted = true;
			try {
				proc.kill("SIGTERM");
			} catch {
				/* process may have already exited */
			}
		};

		if (abortSignal) {
			abortSignal.addEventListener("abort", onAbort);
		}

		const stdoutTail = drainTail(proc.stdout).catch(() => "");
		const stderrTail = drainTail(proc.stderr).catch(() => "");

		try {
			const [text] = await Promise.all([
				Bun.file(proc.stdio[3] as number).text(),
				proc.exited,
			]);

			if (aborted || abortSignal?.aborted) {
				throw new DOMException(
					"Subagent execution was interrupted",
					"AbortError",
				);
			}

			const trimmed = text.trim();
			if (!trimmed) {
				const diagnostics = await resolveDiagnostics({
					stdoutTail,
					stderrTail,
				});
				throw new Error(
					`Subagent subprocess produced no output (exit code ${String(proc.exitCode)})${diagnostics}`,
				);
			}

			let parsed: SubagentSummary & { error?: string };
			try {
				parsed = JSON.parse(trimmed) as SubagentSummary & { error?: string };
			} catch {
				const diagnostics = await resolveDiagnostics({
					stdoutTail,
					stderrTail,
				});
				throw new Error(
					`Subagent subprocess wrote non-JSON output (exit code ${String(proc.exitCode)}): ${trimmed.slice(0, 200)}${diagnostics}`,
				);
			}

			if (parsed.error) {
				const diagnostics = await resolveDiagnostics({
					stdoutTail,
					stderrTail,
				});
				throw new Error(`Subagent failed: ${parsed.error}${diagnostics}`);
			}
			if (proc.exitCode !== 0) {
				const diagnostics = await resolveDiagnostics({
					stdoutTail,
					stderrTail,
				});
				throw new Error(
					`Subagent process exited with code ${String(proc.exitCode)}${diagnostics}`,
				);
			}

			const output: SubagentOutput = {
				result: parsed.result,
				inputTokens: parsed.inputTokens,
				outputTokens: parsed.outputTokens,
			};
			if (agentName) output.agentName = agentName;

			return output;
		} catch (error) {
			if (aborted || abortSignal?.aborted) {
				throw new DOMException(
					"Subagent execution was interrupted",
					"AbortError",
				);
			}
			throw error;
		} finally {
			if (abortSignal) {
				abortSignal.removeEventListener("abort", onAbort);
			}
			activeProcs.delete(proc);
		}
	};

	return {
		runSubagent,
		killAll: () => {
			for (const proc of activeProcs) {
				try {
					proc.kill("SIGTERM");
				} catch {
					// Process may have already exited.
				}
			}
		},
	};
}
