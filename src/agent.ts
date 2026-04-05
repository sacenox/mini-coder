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
  ImageContent,
  Message,
  Model,
  TextContent,
  Tool,
  ToolCall,
  ToolResultMessage,
} from "@mariozechner/pi-ai";
import { streamSimple } from "@mariozechner/pi-ai";
import { appendMessage } from "./session.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A registered tool with its definition and execute function. */
export interface AgentTool {
  /** pi-ai tool definition (name, description, parameters schema). */
  definition: Tool;
  /** Execute the tool and return content for the tool result message. */
  execute: (
    args: Record<string, unknown>,
    cwd: string,
    signal?: AbortSignal,
  ) => Promise<ToolExecResult> | ToolExecResult;
}

/** Result from executing a tool. */
export interface ToolExecResult {
  /** Text result. */
  text: string;
  /** Whether the execution encountered an error. */
  isError: boolean;
}

/** Events emitted during the agent loop for UI updates. */
export type AgentEvent =
  | { type: "text_delta"; delta: string }
  | { type: "thinking_delta"; delta: string }
  | { type: "tool_start"; name: string; args: Record<string, unknown> }
  | { type: "tool_end"; name: string; result: ToolExecResult }
  | { type: "done"; message: AssistantMessage }
  | { type: "error"; message: AssistantMessage }
  | { type: "aborted"; message: AssistantMessage };

/** Options for the agent loop. */
export interface RunAgentOpts {
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
  /** Registered tools (built-in + plugin). */
  tools: AgentTool[];
  /** Current message history (mutated in-place as messages are appended). */
  messages: Message[];
  /** Working directory for tool execution. */
  cwd: string;
  /** Abort signal for interruption. */
  signal?: AbortSignal;
  /** Callback for UI events. */
  onEvent?: (event: AgentEvent) => void;
}

/** Result of the agent loop. */
export interface AgentLoopResult {
  /** The updated message history. */
  messages: Message[];
  /** How the loop ended. */
  stopReason: "stop" | "length" | "error" | "aborted";
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
    systemPrompt,
    tools,
    messages,
    cwd,
    signal,
    onEvent,
  } = opts;

  const toolDefs = tools.map((t) => t.definition);
  const toolMap = new Map(tools.map((t) => [t.definition.name, t]));

  while (true) {
    // Build context for this iteration
    const context =
      toolDefs.length > 0
        ? { systemPrompt, messages, tools: toolDefs }
        : { systemPrompt, messages };

    // Stream to LLM
    const streamOpts = signal ? { signal } : {};
    const eventStream = streamSimple(model, context, streamOpts);
    let assistantMessage: AssistantMessage | undefined;

    for await (const event of eventStream) {
      switch (event.type) {
        case "text_delta":
          onEvent?.({ type: "text_delta", delta: event.delta });
          break;
        case "thinking_delta":
          onEvent?.({ type: "thinking_delta", delta: event.delta });
          break;
        case "toolcall_end":
          // Tool calls are collected from the final assistant message
          break;
        case "done":
          assistantMessage = event.message;
          break;
        case "error":
          assistantMessage = event.error;
          break;
      }
    }

    // If somehow we got no message, fall back to the stream result
    if (!assistantMessage) {
      assistantMessage = await eventStream.result();
    }

    // Append assistant message to history and DB
    messages.push(assistantMessage);
    appendMessage(db, sessionId, assistantMessage, turn);

    // Handle stop reasons
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

    // stopReason === "toolUse" — execute tool calls and loop
    const toolCalls = assistantMessage.content.filter(
      (c): c is ToolCall => c.type === "toolCall",
    );

    for (const toolCall of toolCalls) {
      const tool = toolMap.get(toolCall.name);

      let resultContent: (TextContent | ImageContent)[];
      let isError: boolean;

      if (!tool) {
        resultContent = [
          {
            type: "text",
            text: `Unknown tool: ${toolCall.name}`,
          },
        ];
        isError = true;
      } else {
        onEvent?.({
          type: "tool_start",
          name: toolCall.name,
          args: toolCall.arguments,
        });

        const result = await tool.execute(toolCall.arguments, cwd, signal);
        resultContent = [{ type: "text", text: result.text }];
        isError = result.isError;

        onEvent?.({ type: "tool_end", name: toolCall.name, result });
      }

      const toolResultMessage: ToolResultMessage = {
        role: "toolResult",
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        content: resultContent,
        isError,
        timestamp: Date.now(),
      };

      messages.push(toolResultMessage);
      appendMessage(db, sessionId, toolResultMessage, turn);
    }

    // Loop back to stream with updated context
  }
}
