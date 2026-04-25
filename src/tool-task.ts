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

  // For custom effort for speed and less surprises. Consider even using a `taskModel` config value.
  // Also remove the piggy backed abortController.
  const taskOptions = {
    ...options,
    effort: "medium" as ThinkingLevel,
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

  // We actually wrap this in case of exceptions, this breaks the let exceptions bubble
  // overall model at first glance, but it makes sense when you look at this like other
  // tools, if a tool fails it doesn't break the top level conversation, tool failures
  // are common.
  try {
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
  } catch (err) {
    let errorText = "Unknown error.";
    if (err instanceof Error) {
      errorText = `Stopped: ${err.message}\n\n${err.stack ?? ""}`;
    }

    return errorText;
  }

  // TODO: Structured footer for output and edit diffs.

  return output.trim();
}
