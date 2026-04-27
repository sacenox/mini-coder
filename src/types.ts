import {
  type Api,
  type AssistantMessage,
  getProviders,
  type KnownProvider,
  type Message,
  type Model,
  type Static,
  type ThinkingLevel,
  type Tool,
  type ToolResultMessage,
  Type,
} from "@mariozechner/pi-ai";
import type { OAuthCredentials } from "@mariozechner/pi-ai/oauth";

const KnownProviderSchema = Type.Unsafe<KnownProvider>(
  Type.Union(getProviders().map((provider) => Type.Literal(provider))),
);

const ThinkingLevelSchema = Type.Unsafe<ThinkingLevel>(
  Type.Union([
    Type.Literal("minimal"),
    Type.Literal("low"),
    Type.Literal("medium"),
    Type.Literal("high"),
    Type.Literal("xhigh"),
  ]),
);

const ModelSchema = Type.Unsafe<Model<Api>>(
  Type.Object({
    id: Type.String(),
    name: Type.String(),
    api: Type.String(),
    provider: Type.String(),
    baseUrl: Type.String(),
    reasoning: Type.Boolean(),
    input: Type.Array(
      Type.Union([Type.Literal("text"), Type.Literal("image")]),
    ),
    cost: Type.Object({
      input: Type.Number(),
      output: Type.Number(),
      cacheRead: Type.Number(),
      cacheWrite: Type.Number(),
    }),
    contextWindow: Type.Number(),
    maxTokens: Type.Number(),
    headers: Type.Optional(Type.Record(Type.String(), Type.String())),
    compat: Type.Optional(Type.Unknown()),
  }),
);

export const SettingsSchema = Type.Object({
  provider: KnownProviderSchema,
  model: Type.String(),
  effort: ThinkingLevelSchema,
});
export type Settings = Static<typeof SettingsSchema>;

export const CliOptionsSchema = Type.Object({
  provider: KnownProviderSchema,
  model: ModelSchema,
  effort: ThinkingLevelSchema,
  prompt: Type.Optional(Type.String()),
});
export type CliOptions = Static<typeof CliOptionsSchema>;

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
