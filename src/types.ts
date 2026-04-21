import type {
  OAuthCredentials,
  OAuthProviderId,
} from "@mariozechner/pi-ai/oauth";

export type CliOptions = {
  prompt?: string;
  model: string;
  effort: string;
  provider: OAuthProviderId;
};

export type TUIOptions = {
  onStop: () => void;
};

export type SavedOAuthAuth = OAuthCredentials & {
  type: "oauth";
};

export type SavedOAuthCreds = Record<string, SavedOAuthAuth>;
