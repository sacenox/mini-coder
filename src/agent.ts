import {
  type AssistantMessage,
  type Context,
  streamSimple,
  type TextContent,
  type ToolCall,
} from "@mariozechner/pi-ai";
import { getApiKey } from "./oauth";
import type {
  AgentContex,
  AgentEvent,
  AgentToolEvent,
  ToolAndRunner,
} from "./types";

export async function* streamAgent(
  agentCtx: AgentContex,
): AsyncGenerator<AgentEvent> {
  const llmCtx: Context = {
    systemPrompt: agentCtx.systemPrompt,
    tools: agentCtx.tools.map((t) => t.tool),
    messages: agentCtx.messages,
  };

  // Important for refreshing tokens.
  const apiKey = await getApiKey(agentCtx.options);

  // Main agent loop, continues until llm sends a response other than toolCall or has no tool calls.
  while (true) {
    const s = streamSimple(agentCtx.options.model, llmCtx, {
      reasoning: agentCtx.options.effort,
      signal: agentCtx.signal,
      apiKey,
    });

    let partial: AssistantMessage | null = null;
    let added = false;

    for await (const e of s) {
      switch (e.type) {
        case "start":
          partial = e.partial;
          llmCtx.messages.push(e.partial);
          added = true;
          yield { type: "message_start", partial };
          break;

        case "text_start":
        case "text_delta":
        case "text_end":
        case "thinking_start":
        case "thinking_delta":
        case "thinking_end":
        case "toolcall_start":
        case "toolcall_delta":
        case "toolcall_end":
          if (partial) {
            partial = e.partial;
            llmCtx.messages[llmCtx.messages.length - 1] = partial;
            yield { type: "message_update", partial };
          }
          break;

        case "error": {
          const finalMessage = await s.result();
          if (added) {
            llmCtx.messages[llmCtx.messages.length - 1] = finalMessage;
          } else {
            llmCtx.messages.push(finalMessage);
            yield { type: "message_start", partial: { ...finalMessage } };
          }

          yield { type: "message_end", message: finalMessage };
          return;
        }
      }
    }

    const message = await s.result();
    if (added) {
      llmCtx.messages[llmCtx.messages.length - 1] = message;
    } else {
      llmCtx.messages.push(message);
      yield { type: "message_start", partial: { ...message } };
    }
    yield { type: "message_end", message };

    const toolCalls = message.content.filter((c) => c.type === "toolCall");

    // Stop on errors or no tools to call.
    if (message.stopReason !== "toolUse" || toolCalls.length === 0) {
      break;
    }

    const seenToolIds = new Map<string, number>();
    if (toolCalls.length > 0) {
      const ts = toolRunner(toolCalls, agentCtx.tools, agentCtx.signal);

      for await (const e of ts) {
        if (e.type === "tool_update") {
          // Update contex with update or add new.
          const existing = seenToolIds.get(e.partial.toolCallId);
          if (existing && existing >= 0) {
            const m = llmCtx.messages[existing];
            if (m.role === "toolResult") {
              llmCtx.messages[existing] = {
                ...m,
                content: [...m.content, ...e.partial.content],
                isError: e.partial.isError,
              };
            }

            yield {
              type: "tool_message_update",
              partial: e.partial,
            };
          } else {
            llmCtx.messages.push(e.partial);
            seenToolIds.set(e.partial.toolCallId, llmCtx.messages.length - 1);

            yield {
              type: "tool_message_start",
              partial: e.partial,
            };
          }
        } else if (e.type === "tool_result") {
          // Update context with full message and yield
          const idx = llmCtx.messages.findIndex(
            (m) =>
              m.role === "toolResult" && m.toolCallId === e.message.toolCallId,
          );
          if (idx >= 0) {
            llmCtx.messages[idx] = e.message;
          } else {
            llmCtx.messages.push(e.message);
          }

          yield {
            type: "tool_message_end",
            message: e.message,
          };
        }
      }
    }
  }
}

// This should stay stateless, don't accumulate anything at this layer, just proxy
// wrapped runners events.
async function* toolRunner(
  toolCalls: ToolCall[],
  tools: ToolAndRunner[],
  signal?: AbortSignal,
): AsyncGenerator<AgentToolEvent> {
  for (const call of toolCalls) {
    const timestamp = Date.now();
    const tool = tools.find((t) => t.tool.name === call.name);

    if (!tool) {
      yield {
        type: "tool_result",
        message: {
          role: "toolResult",
          toolCallId: call.id,
          toolName: call.name,
          content: [{ type: "text", text: "Error: Tool not found" }],
          isError: true,
          timestamp,
        },
      };
      continue;
    }

    try {
      for await (const e of tool.runner(call.arguments, signal)) {
        // yield deltas for output, full output on result.
        const content: TextContent = { type: "text", text: e.text };

        if (e.type === "output") {
          // handle deltas
          yield {
            type: "tool_update",
            partial: {
              role: "toolResult",
              toolCallId: call.id,
              toolName: call.name,
              content: [content],
              isError: false,
              timestamp,
            },
          };
        } else if (e.type === "result") {
          // handle final message
          yield {
            type: "tool_result",
            message: {
              role: "toolResult",
              toolCallId: call.id,
              toolName: call.name,
              content: [content],
              isError: false,
              timestamp,
            },
          };
        }
      }
    } catch (err) {
      // We don't validate arguments, so it's better to show the errors.
      const error = err instanceof Error ? err.message : "Unknown error";
      yield {
        type: "tool_result",
        message: {
          role: "toolResult",
          toolCallId: call.id,
          toolName: call.name,
          content: [{ type: "text", text: `Error: ${error}` }],
          isError: true,
          timestamp,
        },
      };
    }
  }
}
