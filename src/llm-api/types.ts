import type { LanguageModel } from "ai";

// ─── Provider config ──────────────────────────────────────────────────────────

export interface ProviderConfig {
  /** Human-readable label shown in the status bar */
  label: string;
  /** The resolved AI SDK language model */
  model: LanguageModel;
}

// ─── Messages ─────────────────────────────────────────────────────────────────

export type MessageRole = "user" | "assistant" | "tool";

export interface TextContent {
  type: "text";
  text: string;
}

export interface ToolCallContent {
  type: "tool-call";
  toolCallId: string;
  toolName: string;
  args: unknown;
}

export interface ToolResultContent {
  type: "tool-result";
  toolCallId: string;
  toolName: string;
  result: unknown;
  isError?: boolean;
}

export type MessageContent =
  | TextContent
  | ToolCallContent
  | ToolResultContent
  | string;

export interface Message {
  role: MessageRole;
  content: MessageContent | MessageContent[];
}

// ─── Turn events (streamed to the caller) ─────────────────────────────────────

export interface TextDeltaEvent {
  type: "text-delta";
  delta: string;
}

export interface ToolCallStartEvent {
  type: "tool-call-start";
  toolCallId: string;
  toolName: string;
  args: unknown;
}

export interface ToolResultEvent {
  type: "tool-result";
  toolCallId: string;
  toolName: string;
  result: unknown;
  isError: boolean;
}

export interface TurnCompleteEvent {
  type: "turn-complete";
  inputTokens: number;
  outputTokens: number;
  /**
   * Raw AI SDK ModelMessage objects generated this turn.
   * These are passed directly back to streamText on subsequent turns —
   * do NOT convert them through the internal Message type or they will
   * lose `input`/`output` field fidelity and fail schema validation.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  messages: any[];
}

export interface TurnErrorEvent {
  type: "turn-error";
  error: Error;
}

export type TurnEvent =
  | TextDeltaEvent
  | ToolCallStartEvent
  | ToolResultEvent
  | TurnCompleteEvent
  | TurnErrorEvent;

// ─── Tool definition ──────────────────────────────────────────────────────────

export interface ToolDef<TInput = unknown, TOutput = unknown> {
  name: string;
  description: string;
  /** Zod schema — typed as any here, cast at call sites */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  schema: any;
  execute: (input: TInput) => Promise<TOutput>;
}
