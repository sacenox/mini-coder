import type { Context, Model, ThinkingLevel, Tool } from "@mariozechner/pi-ai";
import type { OAuthCredentials } from "@mariozechner/pi-ai/oauth";

export type CliOptions = {
  model: Model<never>;
  effort: ThinkingLevel;
  prompt?: string;
  jsonOutput?: boolean;
};

export type TUIActiveState = "idle" | "thinking" | "answering" | "calling_tool";

export type TUIMessage = {
  content: string;
  role: "agent" | "tool" | "reasoning" | "user";
  durationMs?: number;
  id?: string;
  timestamp: number;
  label?: string;
  header?: string; // Not a great name, this is used for arguments in tool calls.
};

export type TUIState = {
  options: CliOptions;
  prompt: string;
  messages: TUIMessage[];
  context?: Context;
  activeState: TUIActiveState;
  streaming: boolean;
  stickToBottom: boolean;
  scrollOffset: number;
};

export type SavedOAuthAuth = OAuthCredentials & {
  type: "oauth";
};

export type SavedOAuthCreds = Record<string, SavedOAuthAuth>;

export type ToolAndRunner = {
  tool: Tool;
  runner: (args: Record<string, any>) => string | Promise<string>;
};
