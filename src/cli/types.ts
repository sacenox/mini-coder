import type { ThinkingEffort } from "../llm-api/providers.ts";
export interface CommandContext {
  currentModel: string;
  setModel: (model: string) => void;
  thinkingEffort: ThinkingEffort | null;
  setThinkingEffort: (effort: ThinkingEffort | null) => void;
  showReasoning: boolean;
  setShowReasoning: (show: boolean) => void;
  verboseOutput: boolean;
  setVerboseOutput: (verbose: boolean) => void;
  undoLastTurn: () => Promise<boolean>;
  startNewSession: () => void;
  switchSession: (id: string) => boolean;

  connectMcpServer: (name: string) => Promise<void>;

  startSpinner: (label?: string) => void;
  stopSpinner: () => void;
  cwd: string;
}
