import type {
  Api,
  AssistantMessage,
  KnownProvider,
  Message,
  Model,
  ThinkingLevel,
  Tool,
  ToolResultMessage,
} from "@mariozechner/pi-ai";
import type { OAuthCredentials } from "@mariozechner/pi-ai/oauth";

export type Settings = {
  provider: KnownProvider;
  model: string;
  effort: ThinkingLevel;
};

export type CliOptions = {
  provider: KnownProvider;
  model: Model<Api>;
  effort: ThinkingLevel;
  prompt?: string;
};

type SavedOAuthAuth = OAuthCredentials & {
  type: "oauth";
};
export type SavedOAuthCreds = Record<string, SavedOAuthAuth>;

export type TUIState = {
  options: CliOptions;
  prompt: string;
  messages: Message[];
  contextSize?: number;
  stickToBottom: boolean;
  scrollOffset: number;
  streaming: boolean;
  abortController?: AbortController;
  cwd: string;
  gitBranch?: string;
};

export type AgentContex = {
  systemPrompt: string;
  tools: ToolAndRunner[];
  messages: Message[];
  options: CliOptions;
  signal?: AbortSignal | undefined;
};

export type AgentEvent =
  | {
      type: "message_start" | "message_update";
      partial: AssistantMessage;
    }
  | {
      type: "message_end";
      message: AssistantMessage;
    }
  | {
      type: "tool_message_start" | "tool_message_update";
      partial: ToolResultMessage;
    }
  | {
      type: "tool_message_end";
      message: ToolResultMessage;
    };

export type AgentToolEvent =
  | {
      type: "tool_update";
      partial: ToolResultMessage;
    }
  | {
      type: "tool_result";
      message: ToolResultMessage;
    };

export type ToolRunnerEvent =
  | { type: "output"; text: string }
  | { type: "result"; text: string };

export type ToolAndRunner = {
  tool: Tool;
  runner: (
    args: Record<string, any>,
    signal?: AbortSignal,
  ) => AsyncGenerator<ToolRunnerEvent>;
};
