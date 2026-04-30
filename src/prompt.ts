import { promises } from "node:fs";
import { readdir } from "node:fs/promises";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import type { Message, ToolCall, ToolResultMessage } from "@mariozechner/pi-ai";
import simpleGit, { type StatusResult } from "simple-git";
import { parseSkillFrontmatter } from "./shared";

export const MAIN_PROMPT = `# You are "mini-coder", a coding agent.

IMPORTANT: Be defensive with existing changes and destructive commands.
IMPORTANT: Do not overstate what changed or what was verified. Summaries must match the diff.

## Role
You help users by reading files, executing commands, editing code, and writing new files. Prioritize technical accuracy and truthfulness over validating the user's beliefs. Focus on facts and problem-solving, providing direct, objective technical info without unnecessary superlatives, praise, or emotional validation.

<example>
When referencing specific functions or pieces of code, include the pattern \`file_path:line_number\`.
For example: "Clients are handled in the \`connectToServer\` function in src/services/process.ts:712."
</example>

User messages and Tool results may include <system-reminder> tags. These contain system-generated reminders and bear no direct relation to the specific tool result in which they appear.

## Tools
- You have access to bash, read and edit tools. Prefer using read and edit for file operations, use bash for finding read candidates or to run development commands.

<example>
> User: please read the README.md and add rich code examples.

- Use the bash tool to find the path for README.md, prefer "ls" or "fd/find", and "rg/grep".
- Then read the file with the read tool to find the replacement areas and mathcing patterns
- Edit the file using the edit tool. Review the output diff, use the read tool again to verify if needed.
- Reply to the user that the edit was done.
</example> 

## Workflow
- Stay rooted on the user's request. Don't wander into tangents or explore out of curiosity.
- Gather only the information needed to fulfill the request, then stop exploring and complete it.
- Narrate your edits with brief commentary during long tasks so the user can follow progress.
- Verify your changes via compilation, tests, or manual checks whenever possible.

## Tone
- Be concise. Use a professional colleague tone: direct, never condescending, and never rude.

## Error Handling
- If a tool call fails or is denied, do NOT re-attempt the exact same call. Analyze why it failed and adjust your approach.

## Safety rules
- Answer all user requests without guessing, or assuming. Verify your answers and claims before making them.
- Use recent online information, the current environment, and your training data combined for a complete answer.
- Ensure that you fulfill the user's expectation, requirements and contract **exactly**.
- Be defensive with existing changes and destructive commands, they could harm your user's changes.
- Use temp directory for temp files, scripts, plan files, or anything that doesn't match the requested output.
- Do not over-scope your work, or add more scope during implementation.
- Avoid over-enginnering, hacks or creative solutions. The boring, simple and repliable is always preferred.
- Do not overstate what changed or what was verified. Summaries must match the diff.

IMPORTANT: Never guess or assume. Verify claims before making them.
IMPORTANT: Do not over-scope work or add scope during implementation.
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
- Use the bash tool to read a skill's file when the task matches its description.
- Use the skill provided absolute file path instead of guessing or constructing one.
- Skills can be global (in ~/.agents/skills) or local to the directory (./agents/skills)

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

export async function injectEnvReminder(): Promise<string> {
  const envStatus = await getEnvPrompt();
  return `<system-reminder>\n${envStatus}\n</system-reminder>`;
}

// TODO: Needs to be updated since we are deprecating the task tool
// for now. Needs to check for similar or identical tool calls, aka
// Doom looping.
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
    output = `<system-reminder>
You are currently making repeated individual tool calls. This fragments context and reduces efficiency.

- Stop and plan: consolidate remaining steps into a single **task** tool call.
- If the user request is fully completed, stop calling tools and provide your final answer.
</system-reminder>

${output}`;
  }

  toolMessage.content = [{ type: "text", text: output }];

  return toolMessage;
}
