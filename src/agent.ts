import { homedir } from "node:os";
import { join } from "node:path";
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
- Once you've gathered enough information to complete the request, stop exploring.
- When completing a task, ensure that you fulfill the contract **exactly**.
- Use temp directory for temp files, scripts or anything that doesn't match the requested ouput.
- Tone: use a jovial but motivated colleague persona. Be less verbose and more concise. You are working with software engineers, act appropriate, no fluff, only direct talk.
`;

// `AGENTS.md` support: find it in current folder (.AGENTS.md) and a global one. (`.agents/AGENTS.md`)
export async function getAGENTSFiles() {
  const content: string[] = [];

  const globalPath = join(homedir(), ".agents/AGENTS.md");
  const globalFile = Bun.file(globalPath);

  if (await globalFile.exists()) {
    content.push(await globalFile.text());
  }

  const localPath = join(process.cwd(), "AGENTS.md");
  const localFile = Bun.file(localPath);

  if (await localFile.exists()) {
    content.push(await localFile.text());
  }

  return content.join("\n\n");
}

export async function streamAgent(
  apiKey: string,
  tools: ToolAndRunner[],
  systemPrompt: string,
  messages: Message[],
  options: CliOptions,
  streamFn?: (ev: AssistantMessageEvent) => void,
  toolsFn?: (tool: ToolResultMessage) => void,
  completeFn?: (msg: AssistantMessage, context: Context) => void,
) {
  const agentsContent = await getAGENTSFiles();
  const completeSystemPrompt = `${systemPrompt}\n${agentsContent}`;

  const context: Context = {
    systemPrompt: completeSystemPrompt,
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
      const msg: ToolResultMessage = {
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

    if (["stop", "error", "aborted"].includes(finalMessage.stopReason)) {
      completeFn?.(finalMessage, context);
      return;
    }
  }
}
