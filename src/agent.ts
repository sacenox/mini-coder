import { readdir } from "node:fs/promises";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import {
  type AssistantMessage,
  type Context,
  type Message,
  streamSimple,
  type ToolCall,
  type ToolResultMessage,
} from "@mariozechner/pi-ai";
import { type StatusResult, simpleGit } from "simple-git";
import { getApiKey } from "./oauth";
import { parseSkillFrontmatter } from "./shared";
import type {
  AgentStreamEvent,
  CliOptions,
  ToolAndRunner,
  ToolRunnerEvent,
} from "./types";

const IDENTITY_PROMPT = `# You are "mini-coder", an efficient, elite coding agent.

## Behaviour rules:

**IMPORTANT**: This is your default behaviour, breaking these rules is unacceptable.

- Answer all user requests without guessing, or assuming.
- Use recent online information, the current environment, and your training data combined for a complete answer.
- Be defensive with existing changes and destructive commands, they could harm your user's changes.
- Be efficient, don't get lost with tangents or satisfying your curiosity, root yourself on the user request.
- Narrate your edits with small commentary messages during long tasks.
- Do not over-scope your work, or add more scope during implementation.
- Avoid over-enginnering, hacks or creative solutions. The boring, simple and repliable is always preffered.
- Focus on the user's request requirements to answer accurately and efficiently.
- Once you've gathered enough information to complete the request, stop exploring and complete it.
- Ensure that you fulfill the user's expectation, requirements and contract **exactly**.
- Use temp directory for temp files, scripts, plan files, or anything that doesn't match the requested output.
- Always verify your changes using compilation, testing, and manual verification when possible.
- Do not overstate what changed or what was verified. Never make unverified claims.
- Summaries must match the diff.
- Tone: use a jovial but motivated colleague persona. Be less verbose and more concise. You are working with software engineers, act appropriately, no fluff, only direct talk.`;

export const MAIN_PROMPT = `${IDENTITY_PROMPT}

## Workflow:

- Use this if the user did not specify a workflow.

1. Read the user's message, understand the request.
2. Gather context from the local environment, local code, docs and online related references to the request as needed.
3. Plan your changes by breaking down the request into small tasks, resolve open questions with the user to complete your plan with accuracy and detail.
4. Use the appropriate tools to execute the plan. Keep the plan up to date and follow it accurately.
5. Validate your changes without adding more scope to your work.
6. Summarize your changes and completed plan in your final message.

## Tool selection heuristic:

**Always** follow this logic when deciding your tool usage:

- You have limitted context size, the task tool compresses tool loops for you, keeping your context pressure low.
- Before **every tool call** consider if you are doing too much in your context window, and favor using the task tool.
- If the user's request requires **less** than 3 to 4 shell/edit/read tool calls, use them and complete the request.
- Else, the request requires **more** than 4 shell/edit tool calls, use the \`task()\` tool.
- This is not optional, if you fill your context with exploration, excessive tool calls, then you have none left to help the user. This is unacceptable.

**IMPORTANT: Always make sure you are not falling into a shell tool calling loop!**

- This is a clear sign you should be using the task tool. Stop the loop and use the task tool.
`;

export const TASK_PROMPT = `${IDENTITY_PROMPT}

## Workflow:

1. Read the user message, understand the request. Gather context as needed to complete the request.
2. Plan your changes by breaking down the request into smaller tasks as needed.
3. Execute your plan with the appropriate tools.
4. Validate your changes without adding scope, and ensuring the user's request is met **exactly** with no deviations.
5. Your final message should include a summary of your actions and any diffs from your edits.
`;

async function getEnvPrompt() {
  // TODO: What else do the agents always check before answering every time?
  let gitStatus: StatusResult | { nogit: string };
  try {
    gitStatus = await simpleGit().status();
  } catch (_) {
    gitStatus = { nogit: "No git repo in this folder." };
  }
  const envStatus = JSON.stringify(
    {
      cwd: process.cwd(),
      os: platform(),
      git: gitStatus,
    },
    null,
    4,
  );

  const text = `### Environment status and information

\`\`\`json
  ${envStatus}
\`\`\`
`;

  return text;
}

// `AGENTS.md` support: find it in current folder (./AGENTS.md) and a global one. (`.agents/AGENTS.md`)
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

  return content.join("\n\n").trim();
}

// `SKILLS.md` discovery from [~|.]/agents/skills/*/SKILL.md
export async function getSkills(): Promise<string> {
  let skillsBlock: string = "";
  const skillRoots = [
    join(homedir(), ".agents", "skills"),
    join(process.cwd(), ".agents", "skills"),
  ];

  for (const root of skillRoots) {
    let entries: string[];

    try {
      entries = await readdir(root);
    } catch {
      continue;
    }

    for (const entry of entries) {
      const path = join(root, entry, "SKILL.md");
      const file = Bun.file(path);

      if (!(await file.exists())) {
        continue;
      }

      const parsed = parseSkillFrontmatter(await file.text());

      if (!parsed) {
        continue;
      }

      skillsBlock += `## ${parsed.name}

> Absolute file path to read: ${path}

${parsed.description}

`;
    }
  }

  if (!skillsBlock.length) return "";

  const skills = `# Skills

- The following skills provide specialized instructions for specific tasks.
- Use the shell tool to read a skill's file when the task matches its description.
- Use the skill provided absolute file path instead of guessing or constructing one.
- Skills can be global (in ~/.agents/skills) or locat to the directory (./agents/skills)

${skillsBlock}`;

  return skills.trim();
}

export async function buildSystemPrompt(systemPrompt: string) {
  const agentsContent = await getAGENTSFiles();
  const skillsContent = await getSkills();
  const envStatus = await getEnvPrompt();
  let complete = systemPrompt + envStatus;

  if (skillsContent) {
    complete += `\n${skillsContent}`;
  }

  if (agentsContent) {
    complete += `\n${agentsContent}`;
  }

  return complete;
}

export function insertToolUsageReminder(
  messages: Message[],
  toolMessage: ToolResultMessage,
) {
  // check for the last 5 tool call assistant messages
  // if they are non-`task` tool calls insert the reminder
  // as a prefix.
  let output = toolMessage.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");

  const budget = 5;
  const toolCalls: ToolCall[] = [];
  messages.forEach((m) => {
    if (m.role === "assistant") {
      const toolCallsBlocks = m.content.filter((b) => b.type === "toolCall");
      toolCalls.push(...toolCallsBlocks);
    }
  });
  const recentToolCalls = toolCalls.slice(-budget);
  const taskSeen = recentToolCalls.some((call) => call.name === "task");

  if (toolCalls.length >= budget && !taskSeen) {
    output = `# System reminder:
    
> You are in a shell or edit tool calling loop poluting your context.

- Remember your tool choice heuristic.
- Plan your next actions, and use the task tool to continue.
- If you have completed the user request, complete your answer.

---
    
${output}
`;
  }

  toolMessage.content = [{ type: "text", text: output }];

  return toolMessage;
}

export async function* streamAgent(
  apiKey: string,
  tools: ToolAndRunner[],
  systemPrompt: string,
  messages: Message[],
  options: CliOptions,
  abortController?: AbortController,
): AsyncGenerator<AgentStreamEvent> {
  const context: Context = {
    systemPrompt: await buildSystemPrompt(systemPrompt),
    messages,
    tools: tools.map((t) => t.tool),
  };

  while (true) {
    const s = streamSimple(options.model, context, {
      apiKey,
      reasoning: options.effort,
      signal: abortController?.signal,
    });

    for await (const ev of s) {
      yield { type: "assistant", event: ev, context };
    }

    const finalMessage = await s.result();
    context.messages.push(finalMessage);

    // Check if the agent is done, or an error/abort happened before moving
    // on towards tool calling.
    if (finalMessage.stopReason !== "toolUse") {
      // Agent is done, send the final message, and current context.
      yield { type: "complete", message: finalMessage, context };
      break;
    }

    // TODO: Extract into it's own function
    // Call tolls and per tool result callback.
    const toolCalls = finalMessage.content.filter(
      (msg) => msg.type === "toolCall",
    );

    for (const call of toolCalls) {
      let output = "";
      let isError = false;

      const toolDef = tools.find((item) => item.tool.name === call.name);
      let msg: ToolResultMessage = {
        role: "toolResult",
        toolCallId: call.id,
        toolName: call.name,
        content: [{ type: "text", text: output }],
        isError,
        timestamp: Date.now(),
      };

      if (!toolDef) {
        output = `Unknown tool: ${call.name}`;
        isError = true;
      } else {
        try {
          for await (const event of toolDef.runner(call.arguments)) {
            switch (event.type) {
              case "output":
                output += event.text;
                msg = {
                  ...msg,
                  content: [{ type: "text", text: event.text }],
                };
                yield {
                  type: "tool_output",
                  message: msg,
                  context,
                };
                break;

              case "result":
                output = event.text;
                break;
            }
          }
        } catch (err) {
          const error = err instanceof Error ? err.message : "Unknown error";
          output = `Tool call failed: ${error}`;
          isError = true;
        }
      }

      msg = {
        role: "toolResult",
        toolCallId: call.id,
        toolName: call.name,
        content: [{ type: "text", text: output }],
        isError,
        timestamp: Date.now(),
      };

      // Update with tool results. let the user make changes if they want
      context.messages.push(msg);

      yield {
        type: "tool_result",
        message: msg,
        context,
      };
    }
  }
}

// CONTINUE: exploring a cleaner api for the core. It's a mess of bugs between this and the consumers: task, tui and headless, they all do things slighty different :/ my bad. this will bring some consistency.
type AgentContex = {
  systemPrompt: string;
  tools: ToolAndRunner[];
  messages: Message[];
  options: CliOptions;
  signal: AbortSignal | undefined;
};

type AgentEvent =
  | {
    type: "message_start" | "message_update";
    partial: AssistantMessage;
  }
  | {
    type: "message_end";
    message: AssistantMessage;
  }
  | {
    type: "tool_message_start" | "tool_message_update";
    partial: ToolResultMessage;
  }
  | {
    type: "tool_message_end";
    message: ToolResultMessage;
  };

export async function* _streamAgent(
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

        case "done":
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

    const toolCalls = message.content.filter((c) => c.type === "toolCall");

    // Stop on errors or no tools to call.
    if (message.stopReason !== "toolUse" || toolCalls.length === 0) {
      yield { type: "message_end", message };
      break;
    }

    const toolMessagesMap = new Map<string, ToolResultMessage>()
    if (toolCalls.length > 0) {
      const ts = toolRunner(toolCalls, agentCtx.tools)

      // Append toolResultMessges
      for await (const toolMsg of ts) {
        if (toolMessagesMap.has(toolMsg.toolCallId)) {
          // Already seen, just update
          toolMessagesMap.set(toolMsg.toolCallId, toolMsg);
          llmCtx.messages = llmCtx.messages.map(m => {
            if (m.role === 'toolResult' && m.toolCallId === toolMsg.toolCallId) {
              return toolMsg
            }
            return m
          })
          yield { type: "tool_message_update", partial: toolMsg }
        } else {
          // New, add to context and map.
          toolMessagesMap.set(toolMsg.toolCallId, toolMsg);
          llmCtx.messages.push(toolMsg)
          yield { type: "tool_message_start", partial: toolMsg }
        }
      }

      // Updates done, yield final tool results
      for (const item of toolMessagesMap.values()) {
        yield { type: "tool_message_end", message: item }
      }
    }
  }
}

async function* toolRunner(
  toolCall: ToolCall[],
  tools: ToolAndRunner[],
): AsyncGenerator<ToolResultMessage> {
  return;
}
