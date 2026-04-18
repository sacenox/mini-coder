/**
 * Persisted session-message types and parsing/validation helpers.
 *
 * @module
 */

import type {
  AssistantMessage,
  Message,
  ToolResultMessage,
  UserMessage,
} from "@mariozechner/pi-ai";
import {
  readBoolean,
  readFiniteNumber,
  readString,
  toRecord,
} from "./shared.ts";
import { collapseWhitespaceToNull, joinTextBlocks } from "./text.ts";
import type { TodoItem } from "./tools.ts";

/** Rich-text format hints supported by persisted UI info messages. */
export type UiInfoFormat = "markdown";

/** A persisted UI-only info message shown in the conversation log. */
export interface UiInfoMessage {
  /** Identifies this as an internal UI message. */
  role: "ui";
  /** UI message category for rendering and future behavior. */
  kind: "info";
  /** Display text shown in the conversation log. */
  content: string;
  /** Optional rich-text format hint for the content. */
  format?: UiInfoFormat;
  /** Unix timestamp in milliseconds. */
  timestamp: number;
}

/** A persisted UI-only todo snapshot shown in the conversation log. */
export interface UiTodoMessage {
  /** Identifies this as an internal UI message. */
  role: "ui";
  /** UI message category for rendering and future behavior. */
  kind: "todo";
  /** Todo snapshot rendered in the conversation pane. */
  todos: TodoItem[];
  /** Unix timestamp in milliseconds. */
  timestamp: number;
}

/** A persisted UI-only message shown in the conversation log. */
export type UiMessage = UiInfoMessage | UiTodoMessage;

/** Any message persisted in session history. */
export type PersistedMessage = Message | UiMessage;

const EMPTY_ASSISTANT_USAGE: AssistantMessage["usage"] = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    total: 0,
  },
};

function getMultipartUserPreview(
  content: Extract<Message, { role: "user" }>["content"],
): string | null {
  if (typeof content === "string") {
    return collapseWhitespaceToNull(content);
  }

  return collapseWhitespaceToNull(joinTextBlocks(content));
}

function isTextContentBlock(
  value: unknown,
): value is { type: "text"; text: string } {
  const record = toRecord(value);
  return (
    record !== null &&
    record.type === "text" &&
    readString(record, "text") !== null
  );
}

function isImageContentBlock(
  value: unknown,
): value is { type: "image"; data: string; mimeType: string } {
  const record = toRecord(value);
  return (
    record !== null &&
    record.type === "image" &&
    readString(record, "data") !== null &&
    readString(record, "mimeType") !== null
  );
}

function isThinkingContentBlock(
  value: unknown,
): value is Extract<AssistantMessage["content"][number], { type: "thinking" }> {
  const record = toRecord(value);
  return (
    record !== null &&
    record.type === "thinking" &&
    readString(record, "thinking") !== null
  );
}

function isToolCallContentBlock(
  value: unknown,
): value is Extract<AssistantMessage["content"][number], { type: "toolCall" }> {
  const record = toRecord(value);
  return (
    record !== null &&
    record.type === "toolCall" &&
    readString(record, "id") !== null &&
    readString(record, "name") !== null &&
    toRecord(record.arguments) !== null
  );
}

function isAssistantUsage(value: unknown): value is AssistantMessage["usage"] {
  const usageRecord = toRecord(value);
  const costRecord = toRecord(usageRecord?.cost);
  return (
    usageRecord !== null &&
    costRecord !== null &&
    readFiniteNumber(usageRecord, "input") !== null &&
    readFiniteNumber(usageRecord, "output") !== null &&
    readFiniteNumber(usageRecord, "cacheRead") !== null &&
    readFiniteNumber(usageRecord, "cacheWrite") !== null &&
    readFiniteNumber(usageRecord, "totalTokens") !== null &&
    readFiniteNumber(costRecord, "input") !== null &&
    readFiniteNumber(costRecord, "output") !== null &&
    readFiniteNumber(costRecord, "cacheRead") !== null &&
    readFiniteNumber(costRecord, "cacheWrite") !== null &&
    readFiniteNumber(costRecord, "total") !== null
  );
}

function isStopReason(value: unknown): value is AssistantMessage["stopReason"] {
  return (
    value === "stop" ||
    value === "length" ||
    value === "toolUse" ||
    value === "error" ||
    value === "aborted"
  );
}

function isUserMessageRecord(value: unknown): value is UserMessage {
  const record = toRecord(value);
  if (!record || record.role !== "user") {
    return false;
  }

  return (
    readFiniteNumber(record, "timestamp") !== null &&
    (typeof record.content === "string" ||
      (Array.isArray(record.content) &&
        record.content.every(
          (block) => isTextContentBlock(block) || isImageContentBlock(block),
        )))
  );
}

function parseAssistantMessageRecord(value: unknown): AssistantMessage | null {
  const record = toRecord(value);
  if (!record || record.role !== "assistant") {
    return null;
  }

  const timestamp = readFiniteNumber(record, "timestamp");
  const api = readString(record, "api");
  const provider = readString(record, "provider");
  const model = readString(record, "model");
  const errorMessage = readString(record, "errorMessage");
  if (
    !Array.isArray(record.content) ||
    !record.content.every(
      (block) =>
        isTextContentBlock(block) ||
        isThinkingContentBlock(block) ||
        isToolCallContentBlock(block),
    ) ||
    api === null ||
    provider === null ||
    model === null ||
    !isStopReason(record.stopReason) ||
    (record.errorMessage !== undefined && errorMessage === null) ||
    timestamp === null
  ) {
    return null;
  }

  return {
    role: "assistant",
    content: record.content,
    api,
    provider,
    model,
    usage: isAssistantUsage(record.usage)
      ? record.usage
      : structuredClone(EMPTY_ASSISTANT_USAGE),
    stopReason: record.stopReason,
    ...(errorMessage !== null ? { errorMessage } : {}),
    timestamp,
  };
}

function isToolResultMessageRecord(value: unknown): value is ToolResultMessage {
  const record = toRecord(value);
  if (!record || record.role !== "toolResult") {
    return false;
  }

  return (
    readString(record, "toolCallId") !== null &&
    readString(record, "toolName") !== null &&
    readBoolean(record, "isError") !== null &&
    Array.isArray(record.content) &&
    record.content.every(
      (block) => isTextContentBlock(block) || isImageContentBlock(block),
    ) &&
    readFiniteNumber(record, "timestamp") !== null
  );
}

function isUiMessageRecord(value: unknown): value is UiMessage {
  const record = toRecord(value);
  if (!record || record.role !== "ui") {
    return false;
  }

  const timestamp = readFiniteNumber(record, "timestamp");
  if (timestamp === null) {
    return false;
  }

  if (record.kind === "info") {
    return (
      typeof record.content === "string" &&
      (record.format === undefined || record.format === "markdown")
    );
  }

  return (
    record.kind === "todo" &&
    Array.isArray(record.todos) &&
    record.todos.every(
      (todo) =>
        typeof todo === "object" &&
        todo !== null &&
        typeof (todo as { content?: unknown }).content === "string" &&
        ((todo as { status?: unknown }).status === "pending" ||
          (todo as { status?: unknown }).status === "in_progress" ||
          (todo as { status?: unknown }).status === "completed"),
    )
  );
}

/**
 * Parse one persisted message row from SQLite JSON.
 *
 * Invalid or unsupported rows return `null` so callers can skip corrupt data
 * without crashing session loading.
 *
 * @param data - Raw JSON-serialized message row.
 * @returns The validated persisted message, or `null` when invalid.
 */
export function parsePersistedMessage(data: string): PersistedMessage | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data) as unknown;
  } catch {
    return null;
  }

  if (
    isUserMessageRecord(parsed) ||
    isToolResultMessageRecord(parsed) ||
    isUiMessageRecord(parsed)
  ) {
    return parsed;
  }

  return parseAssistantMessageRecord(parsed);
}

/**
 * Read the first-user preview cached by the session-list query.
 *
 * @param messageData - Raw JSON from the first conversational message row.
 * @returns A collapsed single-line preview, or `null` when unavailable.
 */
export function readFirstUserPreview(
  messageData: string | null,
): string | null {
  if (!messageData) {
    return null;
  }

  const message = parsePersistedMessage(messageData);
  if (!message || message.role !== "user") {
    return null;
  }

  return getMultipartUserPreview(message.content);
}

/**
 * Check whether a persisted message is a UI-only message.
 *
 * @param message - Message to inspect.
 * @returns `true` when the message is a {@link UiMessage}.
 */
export function isUiMessage(message: PersistedMessage): message is UiMessage {
  return message.role === "ui";
}

/**
 * Return an assistant message's usage when the persisted shape is valid.
 *
 * Session rows are treated as untrusted at runtime because older builds or
 * external tooling may have stored assistant messages without a `usage`
 * payload. Invalid or missing usage is ignored instead of crashing session
 * loading or stats calculations.
 *
 * @param message - Message to inspect.
 * @returns The assistant usage payload, or `null` when it is missing/invalid.
 */
export function getAssistantUsage(
  message: PersistedMessage | Message,
): AssistantMessage["usage"] | null {
  if (message.role !== "assistant") {
    return null;
  }

  const messageRecord = toRecord(message);
  const usageRecord = toRecord(messageRecord?.usage);
  const costRecord = toRecord(usageRecord?.cost);
  if (!usageRecord || !costRecord) {
    return null;
  }

  const input = readFiniteNumber(usageRecord, "input");
  const output = readFiniteNumber(usageRecord, "output");
  const cacheRead = readFiniteNumber(usageRecord, "cacheRead");
  const cacheWrite = readFiniteNumber(usageRecord, "cacheWrite");
  const totalTokens = readFiniteNumber(usageRecord, "totalTokens");
  const costInput = readFiniteNumber(costRecord, "input");
  const costOutput = readFiniteNumber(costRecord, "output");
  const costCacheRead = readFiniteNumber(costRecord, "cacheRead");
  const costCacheWrite = readFiniteNumber(costRecord, "cacheWrite");
  const costTotal = readFiniteNumber(costRecord, "total");

  if (
    input === null ||
    output === null ||
    cacheRead === null ||
    cacheWrite === null ||
    totalTokens === null ||
    costInput === null ||
    costOutput === null ||
    costCacheRead === null ||
    costCacheWrite === null ||
    costTotal === null
  ) {
    return null;
  }

  return {
    input,
    output,
    cacheRead,
    cacheWrite,
    totalTokens,
    cost: {
      input: costInput,
      output: costOutput,
      cacheRead: costCacheRead,
      cacheWrite: costCacheWrite,
      total: costTotal,
    },
  };
}
