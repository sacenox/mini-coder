import type { ThinkingEffort } from "../llm-api/providers.ts";
import type { ContextPruningMode } from "../llm-api/turn.ts";
import type { SubagentOutput } from "../tools/subagent.ts";

export interface CommandContext {
	currentModel: string;
	setModel: (model: string) => void;
	thinkingEffort: ThinkingEffort | null;
	setThinkingEffort: (effort: ThinkingEffort | null) => void;
	showReasoning: boolean;
	setShowReasoning: (show: boolean) => void;
	pruningMode: ContextPruningMode;
	setPruningMode: (mode: ContextPruningMode) => void;
	toolResultPayloadCapBytes: number;
	setToolResultPayloadCapBytes: (bytes: number) => void;
	planMode: boolean;
	setPlanMode: (enabled: boolean) => void;
	ralphMode: boolean;
	setRalphMode: (enabled: boolean) => void;
	undoLastTurn: () => Promise<boolean>;
	startNewSession: () => void;

	connectMcpServer: (name: string) => Promise<void>;
	runSubagent: (
		prompt: string,
		agentName?: string,
		model?: string,
	) => Promise<SubagentOutput>;

	activeAgent: string | null;
	setActiveAgent: (name: string | null, systemPrompt?: string) => void;

	startSpinner: (label?: string) => void;
	stopSpinner: () => void;
	cwd: string;
}
