import { loadAgents } from "../cli/agents.ts";
import { formatSubagentLabel } from "../cli/output.ts";
import { parseModelString, resolveModel } from "../llm-api/providers.ts";
import { type CoreMessage, runTurn } from "../llm-api/turn.ts";
import type { SubagentOutput } from "../tools/subagent.ts";
import type { AgentReporter } from "./reporter.ts";
import { buildSystemPrompt } from "./system-prompt.ts";
import { buildToolSet } from "./tools.ts";

export function createSubagentRunner(
	cwd: string,
	reporter: AgentReporter,
	getCurrentModel: () => string,
) {
	let nextLaneId = 1;
	const activeLanes = new Set<number>();

	const runSubagent = async (
		prompt: string,
		depth = 0,
		agentName?: string,
		modelOverride?: string,
		parentLabel?: string,
	): Promise<SubagentOutput> => {
		const currentModel = getCurrentModel();
		const allAgents = loadAgents(cwd);
		const agentConfig = agentName ? allAgents.get(agentName) : undefined;
		if (agentName && !agentConfig) {
			throw new Error(
				`Unknown agent "${agentName}". Available agents: ${[...allAgents.keys()].join(", ") || "(none)"}`,
			);
		}

		const model = modelOverride ?? agentConfig?.model ?? currentModel;
		const systemPrompt =
			agentConfig?.systemPrompt ?? buildSystemPrompt(cwd, model);

		const subMessages: CoreMessage[] = [{ role: "user", content: prompt }];
		const laneId = nextLaneId++;
		activeLanes.add(laneId);
		const laneLabel = formatSubagentLabel(laneId, parentLabel);

		const subTools = buildToolSet({
			cwd,
			depth,
			runSubagent,
			onHook: (tool, path, ok) => reporter.renderHook(tool, path, ok),
			availableAgents: allAgents,
			parentLabel: laneLabel,
		});

		const subLlm = resolveModel(model);

		let result = "";
		let inputTokens = 0;
		let outputTokens = 0;

		const events = runTurn({
			model: subLlm,
			modelString: model,
			messages: subMessages,
			tools: subTools,
			systemPrompt,
		});

		for await (const event of events) {
			reporter.stopSpinner();
			reporter.renderSubagentEvent(event, {
				laneId,
				...(parentLabel ? { parentLabel } : {}),
				activeLanes,
			});
			reporter.startSpinner("thinking");
			if (event.type === "text-delta") result += event.delta;
			if (event.type === "turn-complete") {
				inputTokens = event.inputTokens;
				outputTokens = event.outputTokens;
			}
		}

		activeLanes.delete(laneId);
		return { result, inputTokens, outputTokens };
	};

	return runSubagent;
}
