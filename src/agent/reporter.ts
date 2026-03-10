import type { CoreMessage } from "../llm-api/turn.ts";
import type { TurnEvent } from "../llm-api/types.ts";

export interface TurnResult {
	inputTokens: number;
	outputTokens: number;
	contextTokens: number;
	newMessages: CoreMessage[];
}

export interface StatusBarData {
	model: string;
	provider: string;
	cwd: string;
	gitBranch: string | null;
	sessionId: string;
	inputTokens: number;
	outputTokens: number;
	contextTokens: number;
	contextWindow: number;
	ralphMode: boolean;
	thinkingEffort?: string | null;
	activeAgent?: string | null;
}

export interface AgentReporter {
	info(msg: string): void;
	error(msg: string | Error, hint?: string): void;
	warn(msg: string): void;
	writeText(text: string): void; // For raw text like passthrough shell output

	startSpinner(label?: string): void;
	stopSpinner(): void;

	renderTurn(events: AsyncIterable<TurnEvent>): Promise<TurnResult>;
	renderStatusBar(data: StatusBarData): void;
	renderHook(toolName: string, scriptPath: string, success: boolean): void;

	restoreTerminal(): void;
}
