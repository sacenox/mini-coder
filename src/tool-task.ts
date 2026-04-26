import {
  type Message,
  type ThinkingLevel,
  type Tool,
  Type,
} from "@mariozechner/pi-ai";
import { streamAgent, TASK_PROMPT } from "./agent";
import { getApiKey } from "./oauth";
import { elapsedTime, estimateTokens } from "./shared";
import { bash, runBashTool } from "./tool-bash";
import { edit, runEditTool } from "./tool-edit";
import type { CliOptions, ToolAndRunner, ToolRunnerEvent } from "./types";

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
  options: CliOptions & { abortController?: AbortController },
  args: Record<string, any>,
): AsyncGenerator<ToolRunnerEvent> {
  const apiKey = await getApiKey(options);
  const tools: ToolAndRunner[] = [
    {
      tool: bash,
      runner: (args) => runBashTool(args, options.abortController?.signal),
    },
    {
      tool: edit,
      runner: (args) => runEditTool(args, options.abortController?.signal),
    },
  ];
  const messages: Message[] = [
    { role: "user", content: args.prompt, timestamp: Date.now() },
  ];

  // For custom effort for speed and less surprises. Consider even using a `taskModel` config value.
  // Also remove the piggy backed abortController
  const taskOptions = {
    ...options,
    effort: "medium" as ThinkingLevel,
    abortController: undefined,
  };

  let output = "";

  // We actually wrap this in case of exceptions, this breaks the let exceptions bubble
  // overall model at first glance, but it makes sense when you look at this like other
  // tools, if a tool fails it doesn't break the top level conversation, tool failures
  // are common.
  try {
    for await (const ev of streamAgent(
      apiKey,
      tools,
      TASK_PROMPT,
      messages,
      taskOptions,
      options.abortController,
    )) {
      if (ev.type === "assistant" && ev.event.type === "text_end") {
        output += ev.event.content;
        yield { type: "output", text: ev.event.content };
      }

      if (ev.type === "tool_result") {
        const estimate = estimateTokens(JSON.stringify(ev.message.content));
        const elapsed = elapsedTime(Date.now() - ev.message.timestamp);
        const text = `Called ${ev.message.toolName}. ~(${estimate} tokens). ${elapsed} ago`;
        output += text;
        yield {
          type: "output",
          text,
        };
      }

      if (ev.type === "complete") {
        if (["stop", "error", "aborted"].includes(ev.message.stopReason)) {
          if (ev.message.errorMessage)
            output += `\n\nStopped: ${ev.message.stopReason}, message:\n${ev.message.errorMessage}`;
        }
      }
    }
  } catch (err) {
    let errorText = "Unknown error.";
    if (err instanceof Error) {
      errorText = `Stopped: ${err.message}\n\n${err.stack ?? ""}`;
    }

    yield { type: "result", text: `${output}\n\n${errorText}` };

    return errorText;
  }

  // TODO: Structured footer for output and edit diffs.
  yield { type: "result", text: output };
  return output.trim();
}
