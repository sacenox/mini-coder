import { type Message, type Tool, Type } from "@mariozechner/pi-ai";
import { streamAgent } from "./agent";
import { buildSystemPrompt, TASK_PROMPT } from "./prompt";
import { estimateTokens, formatTimestamp } from "./shared";
import { bash, runBashTool } from "./tool-bash";
import { edit, runEditTool } from "./tool-edit";
import type {
  AgentContex,
  CliOptions,
  ToolAndRunner,
  ToolRunnerEvent,
} from "./types";

const description = `## Task tool

Best practices using this tool:

- Use detailed and specific prompts, be explicit about the expected output and guardrails.
- Task tool doesn't know your context, make sure you include all relevant context and details.
- Break your work down into small tasks, one small job for each task call.
- Use this tool for breaking down large reading tasks, like reviews, audits, reading docs or doing data research.
- Use this tool to break down large tasks into smaller steps, like implementing plans, editing a large number
of files, addressing large fixes.
- When describing edits, include detailed descriptions and validation requirements.
- Always include all context, scope, constraints, and expected output.
- Be careful with overlapping work when using \`task()\` in parallel.
- Trust but verify the task tool output.
`;

export const task: Tool = {
  name: "task",
  description,
  parameters: Type.Object({
    prompt: Type.String({
      description: "The detailed description of the task you want complete.",
    }),
  }),
};

export async function* runTaskTool(
  options: CliOptions,
  args: Record<string, any>,
  signal?: AbortSignal,
): AsyncGenerator<ToolRunnerEvent> {
  const tools: ToolAndRunner[] = [
    { tool: bash, runner: runBashTool },
    { tool: edit, runner: runEditTool },
  ];
  const messages: Message[] = [
    { role: "user", content: args.prompt || "", timestamp: Date.now() },
  ];

  const systemPrompt = await buildSystemPrompt(TASK_PROMPT);
  const ctx: AgentContex = {
    systemPrompt,
    tools,
    messages,
    options,
    signal,
  };

  let output = "";
  const agent = streamAgent(ctx);
  for await (const ev of agent) {
    switch (ev.type) {
      case "message_start": {
        const text = `[${formatTimestamp(ev.partial.timestamp)}] Working...`;
        output += text;
        yield { type: "output", text };
        break;
      }
      case "message_end": {
        const thinking = ev.message.content
          .filter((b) => b.type === "thinking")
          .map((b) => b.thinking)
          .join("");
        const messageText = ev.message.content
          .filter((b) => b.type === "text")
          .map((b) => b.text)
          .join("");
        const calls = ev.message.content
          .filter((b) => b.type === "toolCall")
          .map((b) => b.name);

        let text = `[${formatTimestamp(ev.message.timestamp)}]`;
        if (thinking.length > 0) {
          const thinkingTokens = estimateTokens(thinking);
          text += `Thinking... (${thinkingTokens} tokens)`;
        }
        if (messageText.length > 0) {
          text += `\n\n${messageText}\n`;
        }
        if (calls.length > 0) {
          text += ` \nTool calls:`;
          for (const c of calls) {
            text += `\n${c}`;
          }
        }

        output += text;
        yield { type: "output", text };
        break;
      }
      case "tool_message_end": {
        const ts = formatTimestamp(ev.message.timestamp);
        const name = ev.message.toolName;
        const symbol = !ev.message.isError ? "✓ " : "✗ ";
        const text = `[${ts}] ${name} ${symbol}`;

        output += text;
        yield { type: "output", text };
        break;
      }
    }
  }

  yield { type: "result", text: output };
}
