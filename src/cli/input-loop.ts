import type { AgentReporter } from "../agent/reporter.ts";
import type { SessionRunner } from "../agent/session-runner.ts";

import { getContextWindow } from "../llm-api/providers.ts";
import { buildSessionExitMessage } from "../session/resume-command.ts";
import { runShellCommand, type ShellOutput } from "../tools/shell.ts";
import { handleCommand } from "./commands.ts";
import { resolveFileRefs } from "./file-refs.ts";
import { type InputResult, readline } from "./input.ts";
import { renderUserMessage, tildePath } from "./output.ts";
import { buildToolCallLine, renderToolResult } from "./tool-render.ts";

import type { CommandContext } from "./types.ts";

interface InputLoopOptions {
  cwd: string;
  reporter: AgentReporter;
  cmdCtx: CommandContext;
  runner: SessionRunner;
}

function buildShellContext(result: ShellOutput): string {
  const sections: string[] = [];
  if (result.stdout) sections.push(result.stdout);
  if (result.stderr) sections.push(`stderr:\n${result.stderr}`);
  if (result.timedOut) sections.push("command timed out");
  if (!result.success) sections.push(`exit code: ${result.exitCode}`);
  if (sections.length === 0)
    sections.push(`(no output, exit ${result.exitCode})`);
  return sections.join("\n\n").trim();
}

async function getGitBranch(cwd: string): Promise<string | null> {
  try {
    const proc = Bun.spawn(["git", "rev-parse", "--abbrev-ref", "HEAD"], {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });
    const out = await new Response(proc.stdout).text();
    const code = await proc.exited;
    if (code !== 0) return null;
    return out.trim() || null;
  } catch {
    return null;
  }
}

export async function runInputLoop(opts: InputLoopOptions): Promise<void> {
  const { cwd, reporter, cmdCtx, runner } = opts;

  while (true) {
    const branch = await getGitBranch(cwd);
    const status = runner.getStatusInfo();
    const cwdDisplay = tildePath(cwd);
    const contextWindow = getContextWindow(status.model);
    reporter.renderStatusBar({
      model: status.model,
      cwd: cwdDisplay,
      gitBranch: branch,
      sessionId: status.sessionId,
      inputTokens: status.totalIn,
      outputTokens: status.totalOut,
      contextTokens: status.lastContextTokens,
      contextWindow,
      thinkingEffort: status.thinkingEffort,
    });

    let input: InputResult;
    try {
      input = await readline({ cwd });
    } catch {
      break;
    }

    switch (input.type) {
      case "eof":
        reporter.writeText(buildSessionExitMessage(runner.session.id));
        return;

      case "interrupt":
        continue;

      case "command": {
        const result = await handleCommand(input.command, input.args, cmdCtx);
        if (result.type === "exit") {
          reporter.writeText(buildSessionExitMessage(runner.session.id));
          return;
        }
        if (result.type === "inject-user-message") {
          renderUserMessage(result.text);
          const { text: resolvedText, images: refImages } =
            await resolveFileRefs(result.text, cwd);
          try {
            await runner.processUserInput(resolvedText, refImages);
          } catch {
            // Error already rendered by stream-render; continue the loop.
          }
        }
        continue;
      }

      case "shell": {
        reporter.writeText(
          `  ${buildToolCallLine("shell", { command: input.command })}`,
        );
        const result = await runShellCommand({
          command: input.command,
          timeout: 30_000,
          cwd,
        });
        renderToolResult("shell", result, false, {
          verboseOutput: cmdCtx.verboseOutput,
        });
        const context = buildShellContext(result);
        if (context) {
          runner.addShellContext(input.command, context);
        }
        continue;
      }

      case "submit": {
        renderUserMessage(input.text);
        const { text: resolvedText, images: refImages } = await resolveFileRefs(
          input.text,
          cwd,
        );
        const allImages = [...(input.images || []), ...refImages];
        try {
          await runner.processUserInput(resolvedText, allImages);
        } catch {
          // Error already rendered by stream-render; continue the loop.
        }
        continue;
      }
    }
  }
}
