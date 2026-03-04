import { z } from "zod";
import type { ToolDef } from "../llm-api/types.ts";

const SubagentInput = z.object({
	prompt: z.string().describe("The task or question to give the subagent"),
	agentName: z
		.string()
		.optional()
		.describe(
			"Name of a custom agent to use (from .agents/agents/). Omit to use a generic subagent.",
		),
});

type SubagentInput = z.infer<typeof SubagentInput>;

export interface SubagentOutput {
	result: string;
	inputTokens: number;
	outputTokens: number;
	mergeConflict?: {
		branch: string;
		conflictFiles: string[];
	};
	mergeBlocked?: {
		branch: string;
		conflictFiles: string[];
	};
}

function formatConflictFiles(conflictFiles: string[]): string {
	if (conflictFiles.length === 0) return "  - (unknown)";
	return conflictFiles.map((file) => `  - ${file}`).join("\n");
}

export function getSubagentMergeError(output: SubagentOutput): string | null {
	if (output.mergeConflict) {
		const files = formatConflictFiles(output.mergeConflict.conflictFiles);
		return `⚠ Merge conflict: subagent branch "${output.mergeConflict.branch}" has been merged into your working tree
but has conflicts in these files:
${files}

Resolve the conflicts (remove <<<<, ====, >>>> markers), stage the files with
\`git add <file>\`, then run \`git merge --continue\` to complete the merge.`;
	}
	if (output.mergeBlocked) {
		const files = formatConflictFiles(output.mergeBlocked.conflictFiles);
		return `⚠ Merge deferred: subagent branch "${output.mergeBlocked.branch}" was not merged because another merge is already in progress.
Current unresolved files:
${files}

Resolve the current merge first (remove <<<<, ====, >>>> markers), stage files with
\`git add <file>\`, run \`git merge --continue\`, then merge the deferred branch with
\`git merge --no-ff ${output.mergeBlocked.branch}\`.`;
	}
	return null;
}

/**
 * The subagent tool factory.
 *
 * We accept a `runSubagent` callback so the tool can call back into
 * the agent without creating a circular import.
 */
export function createSubagentTool(
	runSubagent: (
		prompt: string,
		agentName?: string,
		parentLabel?: string,
	) => Promise<SubagentOutput>,
	availableAgents: ReadonlyMap<string, { description: string }>,
	parentLabel?: string,
): ToolDef<SubagentInput, SubagentOutput> {
	const agentSection =
		availableAgents.size > 0
			? `\n\nWhen the user's message contains @<agent-name>, delegate to that agent by setting agentName to the exact agent name. Available custom agents: ${[...availableAgents.entries()].map(([name, cfg]) => `"${name}" (${cfg.description})`).join(", ")}.`
			: "";
	return {
		name: "subagent",
		description: `Spawn a sub-agent to handle a focused subtask. Use this for parallel exploration, specialised analysis, or tasks that benefit from a fresh context window. ${agentSection}`,
		schema: SubagentInput,
		execute: async (input) => {
			return runSubagent(input.prompt, input.agentName, parentLabel);
		},
	};
}
