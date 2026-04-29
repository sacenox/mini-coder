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

Use this tool for multi-step work that would otherwise require multiple individual tool calls. The tool executes a detailed plan and returns results.

Best practices:

- For exploration (codebase, filesystem, web), specify exactly what you are looking for and the expected output format. For example: "Find all files relevant to tests. Return the exact paths and a description of each file."
- For edits, specify exact diffs and the target file for each change.
- For anything else, provide a specific, detailed set of instructions and your expected results.
`;

export const task: Tool = {
  name: "task",
  description,
  parameters: Type.Object({
    prompt: Type.String({
      description:
        "Detailed description of the work to perform. Be specific about expected outputs and any constraints.",
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
