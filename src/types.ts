import {
  type Api,
  type AssistantMessage,
  type Message,
  type Model,
  type Static,
  type ThinkingLevel,
  type Tool,
  type ToolResultMessage,
  Type,
} from "@earendil-works/pi-ai";
import type { OAuthCredentials } from "@earendil-works/pi-ai/oauth";
import { TUI_THEME_IDS, type TUIThemeId } from "./themes";

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

const TUIThemeIdSchema = Type.Unsafe<TUIThemeId>(
  Type.Union(TUI_THEME_IDS.map((id) => Type.Literal(id))),
);

export const SettingsSchema = Type.Object({
  provider: Type.String(),
  model: Type.String(),
  effort: ThinkingLevelSchema,
  customProviders: Type.Optional(Type.Array(ModelSchema)),
  theme: Type.Optional(TUIThemeIdSchema),
});
export type Settings = Static<typeof SettingsSchema>;

export const CliOptionsSchema = Type.Object({
  provider: Type.String(),
  model: ModelSchema,
  effort: ThinkingLevelSchema,
  prompt: Type.Optional(Type.String()),
  customProviders: Type.Optional(Type.Array(ModelSchema)),
  theme: TUIThemeIdSchema,
});
export type CliOptions = Static<typeof CliOptionsSchema>;

type SavedOAuthAuth = OAuthCredentials & {
  type: "oauth";
};
export type SavedOAuthCreds = Record<string, SavedOAuthAuth>;

export const MessageSchema = Type.Unsafe<Message>({});
export const SessionSchema = Type.Object({
  id: Type.String(),
  cwd: Type.String(),
  messages: Type.Array(MessageSchema),
});
export type Session = Static<typeof SessionSchema>;
export type Sessions = Session[];

export type TUIToolCall = {
  id: string;
  tool: string;
  args: Record<string, any>;
  output: string;
};

export type TUIMessage = {
  timestamp: string;
  role: "user" | "assistant";
  text: string;
  thinking?: string;
  toolCalls?: TUIToolCall[];
};

export type AvailableUpdate = {
  currentVersion: string;
  latestVersion: string;
};

export type TUIState = {
  options: CliOptions;
  prompt: string;
  messages: Message[]; // Context messages
  tuiMessages: TUIMessage[];
  contextSize?: number;
  stickToBottom: boolean;
  scrollOffset: number;
  streaming: boolean;
  abortController?: AbortController;
  cwd: string;
  gitBranch?: string;
  availableUpdate?: AvailableUpdate | undefined;
  overlay?: boolean | undefined;
  forceThemeRefresh?: boolean | undefined;
  sessionId?: string | undefined;
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
  | {
      type: "result";
      text: string;
      image?: { data: string; mimeType: string };
    };

export type ToolAndRunner = {
  tool: Tool;
  runner: (
    args: Record<string, any>,
    signal?: AbortSignal,
  ) => AsyncGenerator<ToolRunnerEvent>;
};

export type SelectListItem = {
  label: string;
  value: string;
};

export type SelectState = {
  value: string;
  selected: string;
  label: string;
  list: SelectListItem[];
};

export type SelectOptions = {
  filter: string;
  list: { label: string; value: string }[];
  label?: string | undefined;
  onSelect: (s: SelectState) => void | Promise<void>;
  onCancel: () => void;
};
