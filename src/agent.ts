import {
  type AssistantMessage,
  type AssistantMessageEvent,
  type Context,
  completeSimple,
  type Message,
  streamSimple,
  type ToolResultMessage,
} from "@mariozechner/pi-ai";
import type { CliOptions, ToolAndRunner } from "./types";

export const TASK_PROMPT = `# You are "mini-coder", an elite coding agent.

Behaviour guidelines:

- Answer all user questions without guessing, or assuming. Use recent online information and your training data combined for a complete answer.
- When completing a task, ensure that you fulfill the contract **exactly**.
- Tone: use a jovial but motivated colleague persona. Be less verbose and more concise. You are working with software engineers, act appropriate, no fluff, only direct talk.
`;

export async function streamAgent(
  apiKey: string,
  tools: ToolAndRunner[],
  systemPrompt: string,
  messages: Message[],
  options: CliOptions,
  streamFn?: (ev: AssistantMessageEvent) => void,
  toolsFn?: (tool: ToolResultMessage) => void,
  completeFn?: (msg: AssistantMessage, duration: number) => void,
) {
  const startTs = Date.now();
  const context: Context = {
    systemPrompt,
    messages,
    tools: tools.map((t) => t.tool),
  };

  while (true) {
    const s = streamSimple(options.model, context, {
      apiKey,
      reasoning: options.effort,
    });

    for await (const ev of s) {
      streamFn?.(ev);
    }

    const finalMessage = await s.result();
    context.messages.push(finalMessage);
    const toolCalls = finalMessage.content.filter(
      (msg) => msg.type === "toolCall",
    );

    for (const call of toolCalls) {
      const toolDef = tools.find((i) => i.tool.name === call.name);
      const result = (await toolDef?.runner(call.arguments)) || "";
      const msg: Message = {
        role: "toolResult",
        toolCallId: call.id,
        toolName: call.name,
        content: [{ type: "text", text: result }],
        isError: false,
        timestamp: Date.now(),
      };
      context.messages.push(msg);
      toolsFn?.(msg);
    }

    if (toolCalls.length > 0) {
      // TODO: Investigate why we get an error: `No output for tool call id XXXX...` when
      //       we add { apiKey } in this call. And how does it work without it?
      const cont = await completeSimple(options.model, context, {
        reasoning: options.effort,
      });
      context.messages.push(cont);
    }

    // TODO: usageFn?

    if (["stop", "error", "aborted"].includes(finalMessage.stopReason)) {
      // TODO: Reason?
      completeFn?.(finalMessage, Date.now() - startTs);
      return;
    }
  }
}
