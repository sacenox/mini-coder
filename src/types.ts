import type { Model, ThinkingLevel } from "@mariozechner/pi-ai";
import type { OAuthCredentials } from "@mariozechner/pi-ai/oauth";

export type CliOptions = {
  prompt?: string;
  model: Model<never>;
  effort: ThinkingLevel;
};

export type TUIOptions = {
  onStop: () => void;
};

export type SavedOAuthAuth = OAuthCredentials & {
  type: "oauth";
};

export type SavedOAuthCreds = Record<string, SavedOAuthAuth>;
