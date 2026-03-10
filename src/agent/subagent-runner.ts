import type { ThinkingEffort } from "../llm-api/providers.ts";
import type { SubagentOutput, SubagentSummary } from "../tools/subagent.ts";
import type { AgentReporter } from "./reporter.ts";

/**
 * Resolve the command to invoke a new `mc` subprocess.
 * - Dev:  process.argv[1] ends with ".ts" → [bun, script]
 * - Prod: compiled binary → [process.execPath]
 */
function getMcCommand(): string[] {
	const script = process.argv[1];
	if (script?.endsWith(".ts")) {
		return [process.execPath, script];
	}
	return [process.execPath];
}

// Loose recursion cap passed via environment so subprocess chains are bounded
// without an in-process depth parameter. Generous enough for real use-cases.
const MAX_SUBAGENT_DEPTH = 10;

export function createSubagentRunner(
	cwd: string,
	_reporter: AgentReporter,
	getCurrentModel: () => string,
	_getThinkingEffort: () => ThinkingEffort | null,
) {
	// Active subprocess PIDs — used for interrupt propagation (Phase 5).
	const activePids = new Set<number>();

	// Depth is injected by the parent subprocess via MC_SUBAGENT_DEPTH env var.
	const subagentDepth = parseInt(process.env.MC_SUBAGENT_DEPTH ?? "0", 10);

	const runSubagent = async (
		prompt: string,
		agentName?: string,
		modelOverride?: string,
		_parentLabel?: string,
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
			"1",
			...(agentName ? ["--agent", agentName] : []),
			prompt,
		];

		const proc = Bun.spawn({
			cmd,
			env: {
				...process.env,
				MC_SUBAGENT_DEPTH: String(subagentDepth + 1),
			},
			stdout: "pipe",
			stderr: "inherit",
			stdin: "ignore",
		});

		activePids.add(proc.pid);
		try {
			const [, text] = await Promise.all([
				proc.exited,
				new Response(proc.stdout).text(),
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

			return {
				result: parsed.result,
				inputTokens: parsed.inputTokens,
				outputTokens: parsed.outputTokens,
			};
		} finally {
			activePids.delete(proc.pid);
		}
	};

	return runSubagent;
}
