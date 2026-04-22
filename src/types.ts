import type { Context, Model, ThinkingLevel } from "@mariozechner/pi-ai";
import type { OAuthCredentials } from "@mariozechner/pi-ai/oauth";

export type CliOptions = {
  prompt?: string;
  model: Model<never>;
  effort: ThinkingLevel;
};

export type TUIActiveState = "idle" | "thinking" | "answering" | "calling_tool";

export type TUIMessage = {
  content: string;
  role: "agent" | "tool" | "reasoning" | "user";
  durationMs?: number;
  id?: string;
  timestamp: number;
};

export type TUIState = {
  options: CliOptions;
  prompt: string;
  messages: TUIMessage[];
  context?: Context;
  activeState: TUIActiveState;
  streaming: boolean;
};

export type SavedOAuthAuth = OAuthCredentials & {
  type: "oauth";
};

export type SavedOAuthCreds = Record<string, SavedOAuthAuth>;
