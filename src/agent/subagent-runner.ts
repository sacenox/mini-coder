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
	const script =
		mainModule &&
		!mainModule.endsWith("/[eval]") &&
		!mainModule.endsWith("\\[eval]")
			? mainModule
			: argv1;
	if (script && /\.(?:[cm]?[jt]s)$/.test(script)) {
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
async function consumeTail(
	stream: ReadableStream | null,
	maxBytes = 8192,
): Promise<string> {
	if (!stream) return "";
	const reader = stream.getReader();
	const decoder = new TextDecoder();
	let tail = "";
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			tail += decoder.decode(value, { stream: true });
			if (tail.length > maxBytes * 2) {
				tail = tail.slice(-maxBytes);
			}
		}
		tail += decoder.decode();
	} finally {
		reader.releaseLock();
	}
	return tail.length > maxBytes ? tail.slice(-maxBytes) : tail;
}

function formatSubagentDiagnostics(stdout: string, stderr: string): string {
	const lines = [...stderr.split("\n"), ...stdout.split("\n")]
		.map((line) => line.trim())
		.filter(Boolean);
	if (lines.length === 0) return "";
	const tail = lines.slice(-6).join(" | ");
	return ` (diagnostics: ${tail.slice(0, 300)})`;
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

		try {
			const [text, stdout, stderr] = await Promise.all([
				Bun.file(proc.stdio[3] as number).text(),
				consumeTail(proc.stdout),
				consumeTail(proc.stderr),
				proc.exited,
			]);

			if (aborted || abortSignal?.aborted) {
				throw new DOMException(
					"Subagent execution was interrupted",
					"AbortError",
				);
			}

			const diagnostics = formatSubagentDiagnostics(stdout, stderr);

			const trimmed = text.trim();
			if (!trimmed) {
				throw new Error(
					`Subagent subprocess produced no output (exit code ${String(proc.exitCode)})${diagnostics}`,
				);
			}

			let parsed: SubagentSummary & { error?: string };
			try {
				parsed = JSON.parse(trimmed) as SubagentSummary & { error?: string };
			} catch {
				throw new Error(
					`Subagent subprocess wrote non-JSON output (exit code ${String(proc.exitCode)}): ${trimmed.slice(0, 200)}${diagnostics}`,
				);
			}

			if (parsed.error) {
				throw new Error(`Subagent failed: ${parsed.error}${diagnostics}`);
			}
			if (proc.exitCode !== 0) {
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
