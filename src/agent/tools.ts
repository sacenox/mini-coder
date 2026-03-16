import type { ToolDef } from "../llm-api/types.ts";
import { webContentTool, webSearchTool } from "../tools/exa.ts";
import type { ShellOutput } from "../tools/shell.ts";
import { shellTool } from "../tools/shell.ts";
import { listSkillsTool, readSkillTool } from "../tools/skills.ts";
import { createSubagentTool, type SubagentOutput } from "../tools/subagent.ts";

/**
 * Inject a default cwd if not provided by the LLM.
 */
function withCwdDefault(tool: ToolDef, cwd: string): ToolDef {
	const originalExecute = tool.execute;
	return {
		...tool,
		execute: async (input: unknown) => {
			const patched = (
				typeof input === "object" && input !== null ? input : {}
			) as Record<string, unknown>;
			if (patched.cwd === undefined) patched.cwd = cwd;
			return originalExecute(patched);
		},
	};
}

export function buildToolSet(opts: {
	cwd: string;
	runSubagent: (
		prompt: string,
		agentName?: string,
		modelOverride?: string,
	) => Promise<SubagentOutput>;
	availableAgents: ReadonlyMap<string, { description: string }>;
}): ToolDef[] {
	const { cwd } = opts;

	const shell = withCwdDefault(shellTool as ToolDef, cwd) as ToolDef<
		{ cwd?: string; command: string },
		ShellOutput
	>;

	const tools: ToolDef[] = [
		shell as ToolDef,
		withCwdDefault(listSkillsTool as ToolDef, cwd),
		withCwdDefault(readSkillTool as ToolDef, cwd),
		createSubagentTool(async (prompt, agentName) => {
			const output = await opts.runSubagent(prompt, agentName, undefined);
			return output;
		}, opts.availableAgents) as ToolDef,
	];

	if (process.env.EXA_API_KEY) {
		tools.push(webSearchTool as ToolDef, webContentTool as ToolDef);
	}

	return tools;
}
