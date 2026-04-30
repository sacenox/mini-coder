import {
  type AssistantMessage,
  type Context,
  type ImageContent,
  type Message,
  streamSimple,
  type TextContent,
  type ToolCall,
  type ToolResultMessage,
} from "@mariozechner/pi-ai";
import { getApiKey } from "./oauth";
import type {
  AgentContex,
  AgentEvent,
  AgentToolEvent,
  ToolAndRunner,
} from "./types";

// ### JetBrains Junie: Observation Masking
// Published research found that **simply hiding old tool outputs** matched the quality of full LLM summarization with **zero extra compute**:
// https://blog.jetbrains.com/research/2025/12/efficient-context-management/
export function compactContext(messages: Message[]) {
  // TODO: Preserve SKILL.md contents, and exclude them from compaction.
  // Problem: How do we know? we need to check each message result againt it's arguments
  // and then find if by chance it has a read skill command... This is a mess. We we.
  // A better way would be to first add a read(path, lines, offset). And then we know
  // which files are read using it, and can match by path if it's a SKILL.md ending.
  const KEEP_OBSERVATIONS = 10;

  const toolResultIndices: number[] = [];
  for (let i = 0; i < messages.length; i++) {
    if (messages[i].role !== "toolResult") continue;
    const content = (messages[i] as ToolResultMessage).content;
    if (
      content.length === 1 &&
      content[0].type === "text" &&
      content[0].text.startsWith("Old environment output:")
    ) {
      continue;
    }
    toolResultIndices.push(i);
  }

  if (toolResultIndices.length <= KEEP_OBSERVATIONS) return;

  for (let i = 0; i < toolResultIndices.length - KEEP_OBSERVATIONS; i++) {
    const idx = toolResultIndices[i];
    const msg = messages[idx] as ToolResultMessage;
    let lines = 0;
    let images = 0;
    for (const c of msg.content) {
      if (c.type === "text") {
        lines += c.text.split(/\r?\n/).length;
      } else if (c.type === "image") {
        images++;
      }
    }
    let text = `Old environment output: (${lines} lines omitted)`;
    if (images > 0) {
      text += ` (${images} image${images > 1 ? "s" : ""} omitted)`;
    }
    msg.content = [{ type: "text", text }];
  }
}

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
          // handle final message, and check for images
          let img: ImageContent | null = null;
          if (e.image) {
            img = { ...e.image, type: "image" };
          }

          yield {
            type: "tool_result",
            message: {
              role: "toolResult",
              toolCallId: call.id,
              toolName: call.name,
              content: img ? [content, img] : [content],
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
