import type { CoreMessage } from "../llm-api/turn.ts";
import type { TurnEvent } from "../llm-api/types.ts";

export interface TurnResult {
	inputTokens: number;
	outputTokens: number;
	contextTokens: number;
	newMessages: CoreMessage[];
	reasoningText: string;
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
	thinkingEffort?: string | null;
	activeAgent?: string | null;
	showReasoning?: boolean;
}

export interface AgentReporter {
	info(msg: string): void;
	error(msg: string | Error, hint?: string): void;
	warn(msg: string): void;
	writeText(text: string): void; // For raw text like passthrough shell output
	/** Write a raw output chunk without adding a newline (e.g. streaming shell output). */
	streamChunk(text: string): void;

	startSpinner(label?: string): void;
	stopSpinner(): void;
	/** Print a persistent indented sub-state line (e.g. "snapshot", "hook post-create")
	 *  while the tool is still running. The spinner resumes after. */
	renderSubState(label: string): void;

	renderTurn(
		events: AsyncIterable<TurnEvent>,
		opts?: { showReasoning?: boolean },
	): Promise<TurnResult>;
	renderStatusBar(data: StatusBarData): void;
	renderHook(toolName: string, scriptPath: string, success: boolean): void;

	restoreTerminal(): void;
}
