import type {
  Api,
  AssistantMessage,
  AssistantMessageEvent,
  Context,
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
  jsonOutput?: boolean;
};

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

export type SavedOAuthAuth = OAuthCredentials & {
  type: "oauth";
};

export type SavedOAuthCreds = Record<string, SavedOAuthAuth>;

export type AgentStreamEvent =
  | {
      type: "assistant";
      event: AssistantMessageEvent;
      context: Context;
    }
  | {
      type: "tool_output";
      message: ToolResultMessage;
      context: Context;
    }
  | {
      type: "tool_result";
      message: ToolResultMessage;
      context: Context;
    }
  | {
      type: "complete";
      message: AssistantMessage;
      context: Context;
    };

export type ToolRunnerEvent =
  | { type: "output"; text: string }
  | { type: "result"; text: string };

export type ToolAndRunner = {
  tool: Tool;
  runner: (args: Record<string, any>) => AsyncGenerator<ToolRunnerEvent>;
};
