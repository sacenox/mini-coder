import type { Model } from "@mariozechner/pi-ai";
import type { OAuthCredentials } from "@mariozechner/pi-ai/oauth";

export type CliOptions = {
  prompt?: string;
  model: Model<never>;
  effort: string;
};

export type TUIOptions = {
  onStop: () => void;
};

export type SavedOAuthAuth = OAuthCredentials & {
  type: "oauth";
};

export type SavedOAuthCreds = Record<string, SavedOAuthAuth>;
