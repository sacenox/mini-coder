import { promises } from "node:fs";
import { readdir } from "node:fs/promises";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import type { Message, ToolResultMessage } from "@earendil-works/pi-ai";
import { getGitStatus } from "./git";
import { parseSkillFrontmatter } from "./shared";

export const MAIN_PROMPT = `You are a coding agent interacting with users via the mini-coder harness. You help users by reading files, executing commands, and editting code.

- Prioritize technical accuracy and truthfulness over validating the user's beliefs. Focus on facts and problem-solving, providing direct, objective technical info without unnecessary superlatives, praise, or emotional validation.
- User messages and Tool results may include <system-reminder> tags. These contain system-generated reminders and bear no direct relation to the specific tool result in which they appear.
- You have access to bash, read and edit tools. Prefer using read and edit for file operations, use bash for finding read candidates or to run development commands.
- Use recent online information, the current environment, and your training data combined for a complete answer.
- Ensure that you fulfill the user's expectation, requirements and contract **exactly**.
- Do not overstate what changed or what was verified. Summaries must match the diff.
- Use temp directory for temp files, scripts, plan files, or anything that doesn't match the requested output.
- Be concise. Use a professional colleague tone: direct, never condescending, and never rude.
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
  const gitStatus = await getGitStatus();
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

const doomLoopReminder = `<system-reminder>
You may be entering a tool-call doom loop: recent tool usage is repetitive or not clearly progressing.

- Stop repeating the same or similar tool call unless new evidence requires it.
- Re-read the user's request and summarize what is known, what failed, and what is still needed.
- Change strategy before calling more tools: narrow the next check, use a different source of evidence, or ask the user if blocked.
- If the request is complete, stop calling tools and provide the final answer.
</system-reminder>`;

// Checks recent tool usage for simple repeated-call patterns and inserts an
// anti-doom-loop reminder when the agent appears stuck.
export function insertToolUsageReminder(
  messages: Message[],
  toolMessage: ToolResultMessage,
): ToolResultMessage {
  const lastReminderIdx = messages.findLastIndex((m) => {
    return (
      m.role === "toolResult" &&
      m.content.find(
        (b) => b.type === "text" && b.text.includes(doomLoopReminder),
      )
    );
  });
  const lastUserMessageIdx = messages.findLastIndex((m) => {
    return m.role === "user";
  });
  const messagesSinceLast = messages.slice(
    Math.max(lastReminderIdx, lastUserMessageIdx) + 1,
  );
  const minMessagesForReminder = 4;

  if (messagesSinceLast.length < minMessagesForReminder) return toolMessage;

  let errorCount = 0;
  let sameToolCount = 0;
  const seenArgs = new Set<string>();

  for (const msg of messagesSinceLast) {
    if (msg.role === "toolResult" && msg.isError) errorCount++;

    if (msg.role === "assistant") {
      const calls = msg.content.filter((b) => b.type === "toolCall");
      for (const c of calls) {
        const args = JSON.stringify(c.arguments);
        if (seenArgs.has(args)) sameToolCount++;
        seenArgs.add(args);
      }
    }
  }

  if (
    errorCount >= minMessagesForReminder ||
    sameToolCount >= minMessagesForReminder
  ) {
    return {
      ...toolMessage,
      content: [
        ...toolMessage.content,
        { type: "text", text: doomLoopReminder },
      ],
    };
  }

  return toolMessage;
}
