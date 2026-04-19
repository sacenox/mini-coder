/**
 * Core agent loop.
 *
 * Streams LLM responses, executes tool calls, appends messages to the
 * session history, and loops until the model stops or the user interrupts.
 * Uses pi-ai's {@link streamSimple} for model communication.
 *
 * @module
 */

import type { Database } from "bun:sqlite";
import type {
  AssistantMessage,
  AssistantMessageEvent,
  Message,
  Model,
  ThinkingLevel,
  Tool,
  ToolCall,
  ToolResultMessage,
  UserMessage,
} from "@mariozechner/pi-ai";
import { streamSimple } from "@mariozechner/pi-ai";
import { appendMessage } from "./session.ts";
import { getTodoItems, type ToolExecResult } from "./tools.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A tool execution handler.
 *
 * Called by the agent loop when the model invokes a tool. Arguments are
 * the JSON object parsed by pi-ai from the model's tool call.
 */
/** Callback used by tool handlers to report progressive output updates. */
export type ToolUpdateCallback = (result: ToolExecResult) => void;

export type ToolHandler = (
  args: Record<string, unknown>,
  cwd: string,
  signal?: AbortSignal,
  onUpdate?: ToolUpdateCallback,
) => Promise<ToolExecResult> | ToolExecResult;

export type { ToolExecResult };

/** Events emitted during the agent loop for UI updates. */
export type AgentEvent =
  | {
      type: "text_delta";
      delta: string;
      content: AssistantMessage["content"];
    }
  | {
      type: "thinking_delta";
      delta: string;
      content: AssistantMessage["content"];
    }
  | {
      type: "toolcall_start";
      toolCallId: string;
      name: string;
      args: Record<string, unknown>;
      content: AssistantMessage["content"];
    }
  | {
      type: "toolcall_delta";
      toolCallId: string;
      name: string;
      args: Record<string, unknown>;
      delta: string;
      content: AssistantMessage["content"];
    }
  | {
      type: "toolcall_end";
      toolCallId: string;
      name: string;
      args: Record<string, unknown>;
      content: AssistantMessage["content"];
    }
  | { type: "user_message"; message: UserMessage }
  | { type: "assistant_message"; message: AssistantMessage }
  | {
      type: "tool_start";
      toolCallId: string;
      name: string;
      args: Record<string, unknown>;
    }
  | {
      type: "tool_delta";
      toolCallId: string;
      name: string;
      result: ToolExecResult;
    }
  | {
      type: "tool_end";
      toolCallId: string;
      name: string;
      result: ToolExecResult;
    }
  | { type: "tool_result"; message: ToolResultMessage }
  | { type: "done"; message: AssistantMessage }
  | { type: "error"; message: AssistantMessage }
  | { type: "aborted"; message: AssistantMessage };

/** Options for the agent loop. */
interface RunAgentOpts {
  /** Open database handle. */
  db: Database;
  /** Current session ID. */
  sessionId: string;
  /** Turn number for this agent loop (all messages share this turn). */
  turn: number;
  /** The model to stream with. */
  model: Model<string>;
  /** The assembled system prompt. */
  systemPrompt: string;
  /** Tool definitions sent to the model. */
  tools: Tool[];
  /** Tool name → handler map for executing tool calls. */
  toolHandlers: Map<string, ToolHandler>;
  /** Current message history (mutated in-place as messages are appended). */
  messages: Message[];
  /** Working directory for tool execution. */
  cwd: string;
  /** API key for the provider. */
  apiKey?: string;
  /** Reasoning effort level (e.g. "low", "medium", "high", "xhigh"). */
  effort?: ThinkingLevel;
  /** Abort signal for interruption. */
  signal?: AbortSignal;
  /** Callback for UI events. */
  onEvent?: (event: AgentEvent) => void;
  /** Dequeue the next queued steering message, if one is waiting. */
  takeQueuedUserMessage?: () => UserMessage | null;
}

/** Result of the agent loop. */
interface AgentLoopResult {
  /** The updated message history. */
  messages: Message[];
  /** How the loop ended. */
  stopReason: "stop" | "length" | "error" | "aborted";
}

function cloneAssistantContent(
  content: AssistantMessage["content"],
): AssistantMessage["content"] {
  return content.map((block) => {
    if (block.type === "toolCall") {
      return {
        ...block,
        arguments: structuredClone(block.arguments),
      };
    }
    return { ...block };
  });
}

interface MergedAssistantBlock {
  block: AssistantMessage["content"][number];
  partialStep: number;
  finalStep: number;
}

function mergeAssistantBlocks(
  partialBlock: AssistantMessage["content"][number] | undefined,
  finalBlock: AssistantMessage["content"][number] | undefined,
): MergedAssistantBlock | null {
  if (!partialBlock && !finalBlock) {
    return null;
  }
  if (!partialBlock && finalBlock) {
    return { block: finalBlock, partialStep: 0, finalStep: 1 };
  }
  if (partialBlock && !finalBlock) {
    return { block: partialBlock, partialStep: 1, finalStep: 0 };
  }
  if (!partialBlock || !finalBlock) {
    return null;
  }
  if (partialBlock.type === finalBlock.type) {
    const shouldPreservePartialThinking =
      partialBlock.type === "thinking" &&
      finalBlock.type === "thinking" &&
      partialBlock.thinking &&
      !finalBlock.thinking;
    return {
      block: shouldPreservePartialThinking ? partialBlock : finalBlock,
      partialStep: 1,
      finalStep: 1,
    };
  }
  if (partialBlock.type === "thinking") {
    return { block: partialBlock, partialStep: 1, finalStep: 0 };
  }
  return { block: finalBlock, partialStep: 1, finalStep: 1 };
}

/** Merge streamed partial assistant content into the final message content. */
function mergeAssistantContent(
  partialContent: AssistantMessage["content"],
  finalContent: AssistantMessage["content"],
): AssistantMessage["content"] {
  if (partialContent.length === 0) return finalContent;
  if (finalContent.length === 0) return partialContent;

  const merged: AssistantMessage["content"] = [];
  let partialIndex = 0;
  let finalIndex = 0;

  while (
    partialIndex < partialContent.length ||
    finalIndex < finalContent.length
  ) {
    const nextBlock = mergeAssistantBlocks(
      partialContent[partialIndex],
      finalContent[finalIndex],
    );
    if (!nextBlock) {
      break;
    }
    merged.push(nextBlock.block);
    partialIndex += nextBlock.partialStep;
    finalIndex += nextBlock.finalStep;
  }

  return merged;
}

/** Merge a final assistant message with the richest streamed partial content seen. */
function mergeAssistantMessage(
  partialMessage: AssistantMessage,
  finalMessage: AssistantMessage,
): AssistantMessage {
  return {
    ...finalMessage,
    content: mergeAssistantContent(
      partialMessage.content,
      finalMessage.content,
    ),
  };
}

function toolErrorResult(name: string, error: unknown): ToolExecResult {
  const message = error instanceof Error ? error.message : String(error);

  return {
    content: [{ type: "text", text: `Tool ${name} failed: ${message}` }],
    isError: true,
  };
}

function unknownToolResult(name: string): ToolExecResult {
  return {
    content: [{ type: "text", text: `Unknown tool: ${name}` }],
    isError: true,
  };
}

function buildAgentContext(
  systemPrompt: string,
  messages: Message[],
  tools: Tool[],
) {
  return tools.length > 0
    ? { systemPrompt, messages, tools }
    : { systemPrompt, messages };
}

function buildStreamOptions(
  apiKey: string | undefined,
  effort: ThinkingLevel | undefined,
  signal: AbortSignal | undefined,
) {
  return {
    ...(apiKey ? { apiKey } : {}),
    ...(effort ? { reasoning: effort } : {}),
    ...(signal ? { signal } : {}),
  };
}

interface StreamedToolCallEventPayload {
  toolCallId: string;
  name: string;
  args: Record<string, unknown>;
  content: AssistantMessage["content"];
}

function buildStreamedToolCallEventPayload(
  partial: AssistantMessage,
  contentIndex: number,
  toolCall?: ToolCall,
): StreamedToolCallEventPayload | null {
  const block = toolCall ?? partial.content[contentIndex];
  if (!block || block.type !== "toolCall") {
    return null;
  }

  return {
    toolCallId: block.id,
    name: block.name,
    args: structuredClone(block.arguments),
    content: cloneAssistantContent(partial.content),
  };
}

function handleAssistantStreamEvent(
  event: AssistantMessageEvent,
  onEvent: RunAgentOpts["onEvent"],
): AssistantMessage | null {
  switch (event.type) {
    case "text_delta":
      onEvent?.({
        type: "text_delta",
        delta: event.delta,
        content: cloneAssistantContent(event.partial.content),
      });
      return null;
    case "thinking_delta":
      onEvent?.({
        type: "thinking_delta",
        delta: event.delta,
        content: cloneAssistantContent(event.partial.content),
      });
      return null;
    case "toolcall_start": {
      const payload = buildStreamedToolCallEventPayload(
        event.partial,
        event.contentIndex,
      );
      if (payload) {
        onEvent?.({
          type: "toolcall_start",
          ...payload,
        });
      }
      return null;
    }
    case "toolcall_delta": {
      const payload = buildStreamedToolCallEventPayload(
        event.partial,
        event.contentIndex,
      );
      if (payload) {
        onEvent?.({
          type: "toolcall_delta",
          delta: event.delta,
          ...payload,
        });
      }
      return null;
    }
    case "toolcall_end": {
      const payload = buildStreamedToolCallEventPayload(
        event.partial,
        event.contentIndex,
        event.toolCall,
      );
      if (payload) {
        onEvent?.({
          type: "toolcall_end",
          ...payload,
        });
      }
      return null;
    }
    case "done":
      return event.message;
    case "error":
      return event.error;
    case "start":
    case "text_start":
    case "text_end":
    case "thinking_start":
    case "thinking_end":
      return null;
  }
}

function buildIncompleteAssistantMessage(
  opts: Pick<RunAgentOpts, "model" | "signal">,
  partialAssistantMessage?: AssistantMessage,
): AssistantMessage {
  const stopReason = opts.signal?.aborted ? "aborted" : "error";
  const errorMessage =
    stopReason === "aborted"
      ? "Request was aborted"
      : "Stream ended without a final assistant message";

  return {
    role: "assistant",
    content: partialAssistantMessage
      ? cloneAssistantContent(partialAssistantMessage.content)
      : [],
    api: partialAssistantMessage?.api ?? opts.model.api,
    provider: partialAssistantMessage?.provider ?? opts.model.provider,
    model: partialAssistantMessage?.model ?? opts.model.id,
    usage: partialAssistantMessage?.usage ?? {
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
    },
    stopReason,
    errorMessage,
    timestamp: Date.now(),
  };
}

async function streamAssistantMessage(
  opts: Pick<
    RunAgentOpts,
    | "model"
    | "systemPrompt"
    | "tools"
    | "messages"
    | "apiKey"
    | "effort"
    | "signal"
    | "onEvent"
  >,
): Promise<AssistantMessage> {
  const eventStream = streamSimple(
    opts.model,
    buildAgentContext(opts.systemPrompt, opts.messages, opts.tools),
    buildStreamOptions(opts.apiKey, opts.effort, opts.signal),
  );
  const streamResult = eventStream.result();
  let settledStreamResult: AssistantMessage | undefined;
  void streamResult.then((message) => {
    settledStreamResult = message;
  });

  let assistantMessage: AssistantMessage | undefined;
  let partialAssistantMessage: AssistantMessage | undefined;

  for await (const event of eventStream) {
    if ("partial" in event) {
      partialAssistantMessage = event.partial;
    }

    assistantMessage =
      handleAssistantStreamEvent(event, opts.onEvent) ?? assistantMessage;
  }

  // `end(result)` resolves the final result without emitting a terminal event.
  await Promise.resolve();
  const finalAssistantMessage =
    assistantMessage ??
    settledStreamResult ??
    buildIncompleteAssistantMessage(opts, partialAssistantMessage);
  if (!partialAssistantMessage) {
    return finalAssistantMessage;
  }
  return mergeAssistantMessage(partialAssistantMessage, finalAssistantMessage);
}

function appendUserMessage(
  db: Database,
  sessionId: string,
  messages: Message[],
  userMessage: UserMessage,
  onEvent: RunAgentOpts["onEvent"],
): number {
  messages.push(userMessage);
  const turn = appendMessage(db, sessionId, userMessage);
  onEvent?.({ type: "user_message", message: userMessage });
  return turn;
}

function appendAssistantMessage(
  db: Database,
  sessionId: string,
  messages: Message[],
  assistantMessage: AssistantMessage,
  turn: number,
  onEvent: RunAgentOpts["onEvent"],
): void {
  messages.push(assistantMessage);
  appendMessage(db, sessionId, assistantMessage, turn);
  onEvent?.({ type: "assistant_message", message: assistantMessage });
}

function resolveLoopStopReason(
  assistantMessage: AssistantMessage,
  messages: Message[],
  onEvent: RunAgentOpts["onEvent"],
): AgentLoopResult | null {
  if (
    assistantMessage.stopReason === "error" ||
    assistantMessage.stopReason === "aborted"
  ) {
    const eventType =
      assistantMessage.stopReason === "error" ? "error" : "aborted";
    onEvent?.({ type: eventType, message: assistantMessage });
    return { messages, stopReason: assistantMessage.stopReason };
  }

  return null;
}

function consumeQueuedUserMessage(
  db: Database,
  sessionId: string,
  messages: Message[],
  takeQueuedUserMessage: RunAgentOpts["takeQueuedUserMessage"],
  onEvent: RunAgentOpts["onEvent"],
): number | null {
  const queuedUserMessage = takeQueuedUserMessage?.();
  if (!queuedUserMessage) {
    return null;
  }

  return appendUserMessage(db, sessionId, messages, queuedUserMessage, onEvent);
}

function getAssistantToolCalls(message: AssistantMessage): ToolCall[] {
  return message.content.filter((content): content is ToolCall => {
    return content.type === "toolCall";
  });
}

async function executeToolCall(
  toolCall: ToolCall,
  opts: Pick<RunAgentOpts, "toolHandlers" | "cwd" | "signal" | "onEvent">,
): Promise<ToolExecResult> {
  const handler = opts.toolHandlers.get(toolCall.name);
  if (!handler) {
    return unknownToolResult(toolCall.name);
  }

  opts.onEvent?.({
    type: "tool_start",
    toolCallId: toolCall.id,
    name: toolCall.name,
    args: toolCall.arguments,
  });

  let result: ToolExecResult;
  try {
    if (opts.signal?.aborted) {
      result = toolErrorResult(
        toolCall.name,
        new Error("This operation was aborted"),
      );
    } else {
      result = await handler(
        toolCall.arguments,
        opts.cwd,
        opts.signal,
        (partial) => {
          opts.onEvent?.({
            type: "tool_delta",
            toolCallId: toolCall.id,
            name: toolCall.name,
            result: partial,
          });
        },
      );
    }
  } catch (error) {
    result = toolErrorResult(toolCall.name, error);
  }

  opts.onEvent?.({
    type: "tool_end",
    toolCallId: toolCall.id,
    name: toolCall.name,
    result,
  });
  return result;
}

function appendToolResultMessage(
  db: Database,
  sessionId: string,
  messages: Message[],
  toolCall: ToolCall,
  result: ToolExecResult,
  turn: number,
  onEvent: RunAgentOpts["onEvent"],
): void {
  const toolResultMessage: ToolResultMessage = {
    role: "toolResult",
    toolCallId: toolCall.id,
    toolName: toolCall.name,
    content: result.content,
    ...(result.details !== undefined ? { details: result.details } : {}),
    isError: result.isError,
    timestamp: Date.now(),
  };

  messages.push(toolResultMessage);
  appendMessage(db, sessionId, toolResultMessage, turn);
  onEvent?.({ type: "tool_result", message: toolResultMessage });
}

function getIncompleteTodos(messages: readonly Message[]) {
  return getTodoItems(messages).filter((todo) => todo.status !== "completed");
}

function getTodoReminderSignature(
  todos: ReturnType<typeof getIncompleteTodos>,
): string {
  return JSON.stringify(
    [...todos].sort((left, right) => {
      const contentOrder = left.content.localeCompare(right.content);
      if (contentOrder !== 0) {
        return contentOrder;
      }
      return left.status.localeCompare(right.status);
    }),
  );
}

function wrapSystemReminder(content: string): string {
  return `<system_reminder>\n${content}\n</system_reminder>`;
}

function createTodoReminderMessage(
  messages: readonly Message[],
  remindedTodoSignatures: Set<string>,
): UserMessage | null {
  const incompleteTodos = getIncompleteTodos(messages);
  if (incompleteTodos.length === 0) {
    return null;
  }

  const signature = getTodoReminderSignature(incompleteTodos);
  if (remindedTodoSignatures.has(signature)) {
    return null;
  }
  remindedTodoSignatures.add(signature);

  const lines = [
    "You have pending todo items that must be completed before finishing the task:",
    "",
    ...incompleteTodos.map((todo) => {
      const status = todo.status === "in_progress" ? "IN_PROGRESS" : "PENDING";
      return `- [${status}] ${todo.content}`;
    }),
    "",
    "Please complete all pending items before finishing.",
  ];

  return {
    role: "user",
    content: wrapSystemReminder(lines.join("\n")),
    timestamp: Date.now(),
  };
}

interface StoppedAssistantResolution {
  /** Next turn number when a queued steering message was consumed. */
  nextTurn: number | null;
  /** Ephemeral context messages to include on the next model request. */
  pendingContextMessages: Message[];
  /** Final loop result when the turn should stop immediately. */
  finalResult: AgentLoopResult | null;
}

function resolveStoppedAssistantMessage(
  assistantMessage: AssistantMessage,
  stopReason: "stop" | "length",
  opts: Pick<
    RunAgentOpts,
    "db" | "sessionId" | "messages" | "takeQueuedUserMessage" | "onEvent"
  >,
  remindedTodoSignatures: Set<string>,
): StoppedAssistantResolution {
  const queuedTurn = consumeQueuedUserMessage(
    opts.db,
    opts.sessionId,
    opts.messages,
    opts.takeQueuedUserMessage,
    opts.onEvent,
  );
  if (queuedTurn !== null) {
    return {
      nextTurn: queuedTurn,
      pendingContextMessages: [],
      finalResult: null,
    };
  }

  const todoReminder = createTodoReminderMessage(
    opts.messages,
    remindedTodoSignatures,
  );
  if (todoReminder) {
    return {
      nextTurn: null,
      pendingContextMessages: [todoReminder],
      finalResult: null,
    };
  }

  opts.onEvent?.({ type: "done", message: assistantMessage });
  return {
    nextTurn: null,
    pendingContextMessages: [],
    finalResult: {
      messages: opts.messages,
      stopReason,
    },
  };
}

async function executeAssistantToolCalls(
  assistantMessage: AssistantMessage,
  opts: Pick<
    RunAgentOpts,
    | "db"
    | "sessionId"
    | "messages"
    | "toolHandlers"
    | "cwd"
    | "signal"
    | "onEvent"
    | "model"
  >,
  turn: number,
): Promise<AgentLoopResult | null> {
  for (const toolCall of getAssistantToolCalls(assistantMessage)) {
    const result = await executeToolCall(toolCall, opts);
    appendToolResultMessage(
      opts.db,
      opts.sessionId,
      opts.messages,
      toolCall,
      result,
      turn,
      opts.onEvent,
    );

    if (opts.signal?.aborted) {
      opts.onEvent?.({
        type: "aborted",
        message: buildIncompleteAssistantMessage(
          { model: opts.model, signal: opts.signal },
          assistantMessage,
        ),
      });
      return { messages: opts.messages, stopReason: "aborted" };
    }
  }

  return null;
}

interface AgentIterationOutcome {
  /** Final loop result when the run should stop immediately. */
  finalResult: AgentLoopResult | null;
  /** Next turn number when a queued steering message starts a new turn. */
  nextTurn: number;
  /** Ephemeral context messages for the next model request. */
  pendingContextMessages: Message[];
}

async function resolveAgentIteration(
  assistantMessage: AssistantMessage,
  currentTurn: number,
  remindedTodoSignatures: Set<string>,
  opts: Pick<
    RunAgentOpts,
    | "db"
    | "sessionId"
    | "messages"
    | "toolHandlers"
    | "cwd"
    | "signal"
    | "onEvent"
    | "model"
    | "takeQueuedUserMessage"
  >,
): Promise<AgentIterationOutcome> {
  const stopResult = resolveLoopStopReason(
    assistantMessage,
    opts.messages,
    opts.onEvent,
  );
  if (stopResult) {
    return {
      finalResult: stopResult,
      nextTurn: currentTurn,
      pendingContextMessages: [],
    };
  }

  if (
    assistantMessage.stopReason === "stop" ||
    assistantMessage.stopReason === "length"
  ) {
    const stopResolution = resolveStoppedAssistantMessage(
      assistantMessage,
      assistantMessage.stopReason,
      {
        db: opts.db,
        sessionId: opts.sessionId,
        messages: opts.messages,
        takeQueuedUserMessage: opts.takeQueuedUserMessage,
        onEvent: opts.onEvent,
      },
      remindedTodoSignatures,
    );
    return {
      finalResult: stopResolution.finalResult,
      nextTurn: stopResolution.nextTurn ?? currentTurn,
      pendingContextMessages: stopResolution.pendingContextMessages,
    };
  }

  const toolStopResult = await executeAssistantToolCalls(
    assistantMessage,
    opts,
    currentTurn,
  );
  if (toolStopResult) {
    return {
      finalResult: toolStopResult,
      nextTurn: currentTurn,
      pendingContextMessages: [],
    };
  }

  const queuedTurn = consumeQueuedUserMessage(
    opts.db,
    opts.sessionId,
    opts.messages,
    opts.takeQueuedUserMessage,
    opts.onEvent,
  );
  return {
    finalResult: null,
    nextTurn: queuedTurn ?? currentTurn,
    pendingContextMessages: [],
  };
}

// ---------------------------------------------------------------------------
// Agent loop
// ---------------------------------------------------------------------------

/**
 * Run the agent loop for a single turn.
 *
 * Streams an LLM response, executes any tool calls, appends all messages
 * to the session (sharing the same turn number), and loops back when the
 * model requests tool use. Returns when the model stops, hits a length
 * limit, errors, or is aborted.
 *
 * @param opts - Agent loop options.
 * @returns The loop result with updated messages and stop reason.
 */
export async function runAgentLoop(
  opts: RunAgentOpts,
): Promise<AgentLoopResult> {
  const {
    db,
    sessionId,
    turn,
    model,
    messages,
    signal,
    onEvent,
    toolHandlers,
    cwd,
    takeQueuedUserMessage,
  } = opts;
  let currentTurn = turn;
  let pendingContextMessages: Message[] = [];
  const remindedTodoSignatures = new Set<string>();

  while (true) {
    const assistantMessage = await streamAssistantMessage({
      ...opts,
      messages:
        pendingContextMessages.length > 0
          ? [...messages, ...pendingContextMessages]
          : messages,
    });
    pendingContextMessages = [];
    appendAssistantMessage(
      db,
      sessionId,
      messages,
      assistantMessage,
      currentTurn,
      onEvent,
    );

    const iterationOutcome = await resolveAgentIteration(
      assistantMessage,
      currentTurn,
      remindedTodoSignatures,
      {
        db,
        sessionId,
        messages,
        toolHandlers,
        cwd,
        signal,
        onEvent,
        model,
        takeQueuedUserMessage,
      },
    );
    if (iterationOutcome.finalResult) {
      return iterationOutcome.finalResult;
    }

    currentTurn = iterationOutcome.nextTurn;
    pendingContextMessages = iterationOutcome.pendingContextMessages;
  }
}
