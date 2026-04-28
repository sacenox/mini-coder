import { promises } from "node:fs";
import { readdir } from "node:fs/promises";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import type { Message, ToolCall, ToolResultMessage } from "@mariozechner/pi-ai";
import simpleGit, { type StatusResult } from "simple-git";
import { parseSkillFrontmatter } from "./shared";

const safetyPrompt = `
# Safety rules

- Answer all user requests without guessing, or assuming. Verify your answers and claims before making them.
- Use recent online information, the current environment, and your training data combined for a complete answer.
- Ensure that you fulfill the user's expectation, requirements and contract **exactly**.
- Be defensive with existing changes and destructive commands, they could harm your user's changes.
- Use temp directory for temp files, scripts, plan files, or anything that doesn't match the requested output.
- Do not over-scope your work, or add more scope during implementation.
- Avoid over-enginnering, hacks or creative solutions. The boring, simple and repliable is always preffered.
- Do not overstate what changed or what was verified. Summaries must match the diff.
`;

export const MAIN_PROMPT = `# You are "mini-coder", an efficient and elite level coding agent.

## Behaviour:

- Be efficient, don't get lost with tangents or satisfying your curiosity, root yourself on the user request.
- Always prefer the task tool. It's the intended way of working.
- Keep other tools for single call actions, anything more, you should use the task tool.
- Narrate your edits with small commentary messages during long tasks.
- Focus on the user's request requirements to answer accurately and efficiently.
- Once you've gathered enough information to complete the request, stop exploring and complete it.
- Always verify your changes using compilation, testing, and manual verification when possible.
- Tone: use a jovial but motivated colleague, never condescending, persona. Be less verbose and more concise. Be direct without being rude.

${safetyPrompt}
`;

export const TASK_PROMPT = `# You are an efficient, elite-level task Agent

- Complete the given task with efficiency, and precicely.
- Your final response your include all actions and exact diffs of any changes you might have made. And a report of all actions taken.

${safetyPrompt}
`;

async function getDir() {
  const ignoreFile = Bun.file(".gitignore");
  let ignoreContent = "";
  if (await ignoreFile.exists()) {
    ignoreContent = await ignoreFile.text();
  }
  const ignored = ignoreContent.split("\n");
  const dir = [];
  const glob = promises.glob(["*", "*/*"], { exclude: ignored });
  for await (const file of glob) {
    dir.push(file);
  }
  return dir;
}

async function getEnvPrompt() {
  // TODO: What else do the agents always check before answering every time?
  let gitStatus: StatusResult | { nogit: string };
  try {
    gitStatus = await simpleGit().status();
  } catch (_) {
    gitStatus = { nogit: "No git repo in this folder." };
  }
  const envKeys = ["PATH", "USER", "LANG", "HOME", "SHELL", "BUN_INSTALL"];
  const env: Record<string, string> = {};
  for (const key of envKeys) {
    const v = Bun.env[key];

    if (v !== undefined) {
      env[key] = v;
    }
  }

  const envStatus = JSON.stringify(
    {
      os: platform(),
      env,
      cwd: process.cwd(),
      dir: await getDir(),
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
- Skills can be global (in ~/.agents/skills) or local to the directory (./agents/skills)

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

  const budget = 3;
  const toolCalls: ToolCall[] = [];
  const lastUserMessageIndex = messages.findLastIndex((m) => m.role === "user");
  const messagesSinceLastUser = messages.slice(lastUserMessageIndex + 1);

  messagesSinceLastUser.forEach((m) => {
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
