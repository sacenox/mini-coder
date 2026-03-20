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
  cwd: string;
  gitBranch: string | null;
  sessionId: string;
  inputTokens: number;
  outputTokens: number;
  contextTokens: number;
  contextWindow: number | null;
  thinkingEffort?: string | null;
  showReasoning?: boolean;
}

export interface AgentReporter {
  info(msg: string): void;
  error(msg: string | Error, hint?: string): void;
  warn(msg: string): void;
  writeText(text: string): void;

  startSpinner(label?: string): void;
  stopSpinner(): void;

  renderTurn(
    events: AsyncIterable<TurnEvent>,
    opts?: { showReasoning?: boolean; verboseOutput?: boolean },
  ): Promise<TurnResult>;
  renderStatusBar(data: StatusBarData): void;

  restoreTerminal(): void;
}
