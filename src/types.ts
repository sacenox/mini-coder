import type { Message, Model, ThinkingLevel, Tool } from "@mariozechner/pi-ai";
import type { OAuthCredentials } from "@mariozechner/pi-ai/oauth";

export type CliOptions = {
  model: Model<never>;
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
};

export type SavedOAuthAuth = OAuthCredentials & {
  type: "oauth";
};

export type SavedOAuthCreds = Record<string, SavedOAuthAuth>;

export type ToolAndRunner = {
  tool: Tool;
  runner: (args: Record<string, any>) => string | Promise<string>;
};
