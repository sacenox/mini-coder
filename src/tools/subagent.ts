import { z } from "zod";
import type { ToolDef } from "../llm-api/types.ts";

const SubagentInput = z.object({
	prompt: z.string().describe("The task or question to give the subagent"),
});

type SubagentInput = z.infer<typeof SubagentInput>;

export interface SubagentToolEntry {
	toolName: string;
	args: unknown;
	result: unknown;
	isError: boolean;
}

export interface SubagentOutput {
	result: string;
	inputTokens: number;
	outputTokens: number;
	activity: SubagentToolEntry[];
}

/**
 * The subagent tool factory.
 *
 * We accept a `runSubagent` callback so the tool can call back into
 * the agent without creating a circular import.
 */
export function createSubagentTool(
	runSubagent: (prompt: string) => Promise<SubagentOutput>,
): ToolDef<SubagentInput, SubagentOutput> {
	return {
		name: "subagent",
		description:
			"Spawn a sub-agent to handle a focused subtask. " +
			"Use this for parallel exploration, specialised analysis, or tasks that benefit from " +
			"a fresh context window. The subagent has access to all the same tools.",
		schema: SubagentInput,
		execute: async (input) => {
			return runSubagent(input.prompt);
		},
	};
}
