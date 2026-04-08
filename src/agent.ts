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
  Message,
  Model,
  ThinkingLevel,
  Tool,
  ToolCall,
  ToolResultMessage,
} from "@mariozechner/pi-ai";
import { streamSimple } from "@mariozechner/pi-ai";
import { appendMessage } from "./session.ts";
import type { ToolExecResult } from "./tools.ts";

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
  let assistantMessage: AssistantMessage | undefined;
  let partialAssistantMessage: AssistantMessage | undefined;

  for await (const event of eventStream) {
    if ("partial" in event) {
      partialAssistantMessage = event.partial;
    }

    switch (event.type) {
      case "text_delta":
        opts.onEvent?.({
          type: "text_delta",
          delta: event.delta,
          content: cloneAssistantContent(event.partial.content),
        });
        continue;
      case "thinking_delta":
        opts.onEvent?.({
          type: "thinking_delta",
          delta: event.delta,
          content: cloneAssistantContent(event.partial.content),
        });
        continue;
      case "done":
        assistantMessage = event.message;
        continue;
      case "error":
        assistantMessage = event.error;
        continue;
      case "toolcall_end":
        continue;
    }
  }

  const finalAssistantMessage =
    assistantMessage ?? (await eventStream.result());
  if (!partialAssistantMessage) {
    return finalAssistantMessage;
  }
  return mergeAssistantMessage(partialAssistantMessage, finalAssistantMessage);
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

  if (
    assistantMessage.stopReason === "stop" ||
    assistantMessage.stopReason === "length"
  ) {
    onEvent?.({ type: "done", message: assistantMessage });
    return { messages, stopReason: assistantMessage.stopReason };
  }

  return null;
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
    isError: result.isError,
    timestamp: Date.now(),
  };

  messages.push(toolResultMessage);
  appendMessage(db, sessionId, toolResultMessage, turn);
  onEvent?.({ type: "tool_result", message: toolResultMessage });
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
  const { db, sessionId, turn, messages, signal, onEvent, toolHandlers, cwd } =
    opts;

  while (true) {
    const assistantMessage = await streamAssistantMessage(opts);
    appendAssistantMessage(
      db,
      sessionId,
      messages,
      assistantMessage,
      turn,
      onEvent,
    );

    const stopResult = resolveLoopStopReason(
      assistantMessage,
      messages,
      onEvent,
    );
    if (stopResult) {
      return stopResult;
    }

    for (const toolCall of getAssistantToolCalls(assistantMessage)) {
      const result = await executeToolCall(toolCall, {
        toolHandlers,
        cwd,
        signal,
        onEvent,
      });
      appendToolResultMessage(
        db,
        sessionId,
        messages,
        toolCall,
        result,
        turn,
        onEvent,
      );

      if (signal?.aborted) {
        return { messages, stopReason: "aborted" };
      }
    }
  }
}
