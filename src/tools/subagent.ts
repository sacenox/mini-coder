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

export interface SubagentSummary {
	result: string;
	inputTokens: number;
	outputTokens: number;
}

export interface SubagentOutput {
	result: string;
	inputTokens: number;
	outputTokens: number;
	agentName?: string;
}

/**
 * The subagent tool factory.
 *
 * We accept a `runSubagent` callback so the tool can call back into
 * the agent without creating a circular import.
 */
export function createSubagentTool(
	runSubagent: (prompt: string, agentName?: string) => Promise<SubagentOutput>,
	availableAgents: ReadonlyMap<string, { description: string }>,
): ToolDef<SubagentInput, SubagentOutput> {
	const agentSection =
		availableAgents.size > 0
			? `\n\nIf a specific custom agent should be used, set agentName to the exact agent name. Available custom agents: ${[...availableAgents.entries()].map(([name, cfg]) => `"${name}" (${cfg.description})`).join(", ")}.`
			: "";
	return {
		name: "subagent",
		description: `Spawn a sub-agent to handle a focused subtask.${agentSection}`,
		schema: SubagentInput,
		execute: async (input) => {
			return runSubagent(input.prompt, input.agentName);
		},
	};
}
