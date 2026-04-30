import type { Message } from "@mariozechner/pi-ai";
import { streamAgent } from "./agent";
import { buildSystemPrompt, injectEnvReminder, MAIN_PROMPT } from "./prompt";
import { bash, runBashTool } from "./tool-bash";
import { edit, runEditTool } from "./tool-edit";
import type { AgentContex, CliOptions, ToolAndRunner } from "./types";

export async function streamHeadless(
  options: CliOptions,
  leave: (s?: string) => void,
) {
  const tools: ToolAndRunner[] = [
    { tool: bash, runner: runBashTool },
    { tool: edit, runner: runEditTool },
  ];
  const envReminder = await injectEnvReminder();
  const messages: Message[] = [
    {
      role: "user",
      content: `${envReminder}\n\n${options.prompt || ""}`,
      timestamp: Date.now(),
    },
  ];
  console.log(JSON.stringify(messages[0]));

  const systemPrompt = await buildSystemPrompt(MAIN_PROMPT);
  const ctx: AgentContex = {
    systemPrompt,
    tools,
    messages,
    options,
  };

  const agent = streamAgent(ctx);
  for await (const ev of agent) {
    switch (ev.type) {
      case "message_end":
      case "tool_message_end":
        console.log(JSON.stringify(ev.message));
        break;
    }
  }

  leave();
}
