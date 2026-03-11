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
	): Promise<SubagentOutput> => {
		if (subagentDepth >= MAX_SUBAGENT_DEPTH) {
			throw new Error(
				`Subagent recursion limit reached (depth ${subagentDepth}). ` +
					`Cannot spawn another subagent.`,
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
			stdio: ["ignore", "inherit", "inherit", "pipe"],
		});

		activeProcs.add(proc);

		try {
			const [text] = await Promise.all([
				Bun.file(proc.stdio[3] as number).text(),
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

			return output;
		} finally {
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
