import { readdir } from "node:fs/promises";
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
import { parseSkillFrontmatter } from "./shared";
import type { CliOptions, ToolAndRunner } from "./types";

export const TASK_PROMPT = `# You are "mini-coder", an elite coding agent.

Behaviour guidelines:

- Answer all user questions without guessing, or assuming.
- Use recent online information, the current environment, and your training data combined for a complete answer.
- Once you've gathered enough information to complete the request, stop exploring and complete the task.
- When completing a task, ensure that you fulfill the contract **exactly**.
- Use temp directory for temp files, scripts or anything that doesn't match the requested output.
- Be careful with existing changes and destructive commands, they could harm your user's changes.
- Tone: use a jovial but motivated colleague persona. Be less verbose and more concise. You are working with software engineers, act appropriately, no fluff, only direct talk.
`;

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

> File: ${path}

${parsed.description}

`;
    }
  }

  if (!skillsBlock.length) return "";

  const skills = `# Skills

The following skills provide specialized instructions for specific tasks.
Use the shell tool to read a skill's file when the task matches its description.

${skillsBlock}`;

  return skills.trim();
}

export async function buildSystemPrompt(systemPrompt: string) {
  const agentsContent = await getAGENTSFiles();
  const skillsContent = await getSkills();
  let complete = systemPrompt;

  if (skillsContent) {
    complete += `\n${skillsContent}`;
  }

  if (agentsContent) {
    complete += `\n${agentsContent}`;
  }

  return complete;
}

export async function streamAgent(
  apiKey: string,
  tools: ToolAndRunner[],
  systemPrompt: string,
  messages: Message[],
  options: CliOptions,
  abortController?: AbortController,
  streamFn?: (ev: AssistantMessageEvent) => void,
  toolsFn?: (tool: ToolResultMessage) => void,
  completeFn?: (msg: AssistantMessage, context: Context) => void,
) {
  const context: Context = {
    systemPrompt: await buildSystemPrompt(systemPrompt),
    messages,
    tools: tools.map((t) => t.tool),
  };

  let controller: AbortController
  const onAbort = () => { controller?.abort(); }
  // Wire the global abort signal to each turn http requests
  abortController?.signal.addEventListener('abort', onAbort)

  while (true) {
    controller = new AbortController()
    const s = streamSimple(options.model, context, {
      apiKey,
      reasoning: options.effort,
      signal: controller.signal
    });

    for await (const ev of s) {
      streamFn?.(ev);
    }

    const finalMessage = await s.result();
    context.messages.push(finalMessage);

    if (["stop", "error", "aborted"].includes(finalMessage.stopReason)) {
      completeFn?.(finalMessage, context);
      abortController?.signal.removeEventListener('abort', onAbort)
      return;
    }

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
        signal: controller.signal
      });
      context.messages.push(cont);
    }
  }
}
