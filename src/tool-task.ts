import {
  type AssistantMessage,
  type Message,
  type ThinkingLevel,
  type Tool,
  Type,
} from "@mariozechner/pi-ai";
import { streamAgent, TASK_PROMPT } from "./agent";
import { getApiKey } from "./oauth";
import { bash, runBashTool } from "./tool-bash";
import { edit, runEditTool } from "./tool-edit";
import type { CliOptions, ToolAndRunner } from "./types";

const description = `## Task tool

Best practices using this tool:

- Use detailed prompts, be specific about the expected output and guardrails.
- Task tool doesn't know your context, make sure you include all relevant details.
- Break your work down into small tasks, one small job for each task call.
- Use this tool to explore directories, codebases and the web.
- Use this tool to perform edits, run verifications, and review changes.
- When describing edits, include detailed descriptions and validation requirements.
- Always use it whenever more than one follow-up step is likely.
- Always include all context, scope, constraints, and expected output.
- Be careful with overlapping work when using \`task()\` in parallel.
- Trust but verify the the task's output.
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

export async function runTaskTool(
  options: CliOptions & { abortController?: AbortController },
  args: Record<string, any>,
) {
  const apiKey = await getApiKey(options);
  const tools: ToolAndRunner[] = [
    { tool: bash, runner: runBashTool },
    { tool: edit, runner: runEditTool },
  ];
  const messages: Message[] = [
    { role: "user", content: args.prompt, timestamp: Date.now() },
  ];

  // For custom effort for speed and less suprises. Consider even using a `taskModel` config value.
  // Also remove the piggy backed abortController.
  const taskOptions = {
    ...options,
    effort: "low" as ThinkingLevel,
    abortController: undefined,
  };

  let output = "";
  const onComplete = (ev: AssistantMessage) => {
    output = ev.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n");

    if (["stop", "error", "aborted"].includes(ev.stopReason)) {
      if (ev.errorMessage)
        output += `\n\nStopped: ${ev.stopReason}, message:\n${ev.errorMessage}`;
    }
  };

  await streamAgent(
    apiKey,
    tools,
    TASK_PROMPT,
    messages,
    taskOptions,
    options.abortController,
    undefined,
    undefined,
    onComplete,
  );

  // TODO: Structured footer for output and edit diffs.

  return output.trim();
}
