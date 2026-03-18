import type { ThinkingEffort } from "../llm-api/providers.ts";
import type { ContextPruningMode } from "../llm-api/turn.ts";

export interface CommandContext {
	currentModel: string;
	setModel: (model: string) => void;
	thinkingEffort: ThinkingEffort | null;
	setThinkingEffort: (effort: ThinkingEffort | null) => void;
	showReasoning: boolean;
	setShowReasoning: (show: boolean) => void;
	verboseOutput: boolean;
	setVerboseOutput: (verbose: boolean) => void;
	pruningMode: ContextPruningMode;
	setPruningMode: (mode: ContextPruningMode) => void;
	toolResultPayloadCapBytes: number;
	setToolResultPayloadCapBytes: (bytes: number) => void;
	undoLastTurn: () => Promise<boolean>;
	startNewSession: () => void;

	connectMcpServer: (name: string) => Promise<void>;

	activeAgent: string | null;
	setActiveAgent: (name: string | null, systemPrompt?: string) => void;

	startSpinner: (label?: string) => void;
	stopSpinner: () => void;
	cwd: string;
}
