import { randomBytes } from "node:crypto";
import { unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as c from "yoctocolors";
import { renderHelpCommand } from "./commands-help.ts";
import { handleLoginCommand, handleLogoutCommand } from "./commands-login.ts";
import { handleMcpCommand } from "./commands-mcp.ts";
import { handleModelCommand } from "./commands-model.ts";
import { handleSessionCommand } from "./commands-session.ts";
import { PREFIX, renderBanner, writeln } from "./output.ts";
import { loadSkillContentFromMeta, loadSkillsIndex } from "./skills.ts";

// ─── Types ────────────────────────────────────────────────────────────────────

import type { CommandContext } from "./types.ts";

type CommandResult =
  | { type: "handled" }
  | { type: "unknown"; command: string }
  | { type: "exit" }
  | { type: "inject-user-message"; text: string };

// ─── Command handlers ─────────────────────────────────────────────────────────

async function handleUndo(ctx: CommandContext): Promise<void> {
  ctx.startSpinner("removing last turn");
  try {
    const ok = await ctx.undoLastTurn();
    if (ok) {
      writeln(`${PREFIX.success} ${c.dim("last conversation turn removed")}`);
    } else {
      writeln(`${PREFIX.info} ${c.dim("nothing to undo")}`);
    }
  } finally {
    ctx.stopSpinner();
  }
}

async function handleNew(ctx: CommandContext): Promise<void> {
  await ctx.startNewSession();
  // Clear terminal and reprint banner for a fresh session feel
  process.stdout.write("\x1b[2J\x1b[H");
  await renderBanner(ctx.currentModel, ctx.cwd);
}

// ─── Dispatch ─────────────────────────────────────────────────────────────────

export async function handleCommand(
  command: string,
  args: string,
  ctx: CommandContext,
): Promise<CommandResult> {
  switch (command.toLowerCase()) {
    case "model":
    case "models":
      await handleModelCommand(ctx, args);
      return { type: "handled" };

    case "undo":
      await handleUndo(ctx);
      return { type: "handled" };

    case "reasoning":
      handleReasoningCommand(ctx, args);
      return { type: "handled" };

    case "verbose":
      handleVerboseCommand(ctx, args);
      return { type: "handled" };

    case "mcp":
      await handleMcpCommand(ctx, args);
      return { type: "handled" };

    case "login":
      await handleLoginCommand(ctx, args);
      return { type: "handled" };

    case "logout":
      handleLogoutCommand(ctx, args);
      return { type: "handled" };

    case "session":
    case "sessions":
      await handleSessionCommand(ctx, args);
      return { type: "handled" };

    case "new":
      await handleNew(ctx);
      return { type: "handled" };

    case "help":
    case "?":
      renderHelpCommand(ctx);
      return { type: "handled" };

    case "exit":
    case "quit":
    case "q":
      return { type: "exit" };

    default: {
      // Skill reference: /skill-name injects skill content as a user message.
      const skills = loadSkillsIndex(ctx.cwd);
      const skill = skills.get(command.toLowerCase());
      if (skill) {
        const loaded = loadSkillContentFromMeta(skill);
        if (loaded) {
          const srcPath =
            skill.source === "local"
              ? `.agents/skills/${skill.name}/SKILL.md`
              : `~/.agents/skills/${skill.name}/SKILL.md`;

          // context: fork — run in an isolated mc subprocess
          if (skill.context === "fork") {
            writeln(
              `${PREFIX.info} ${c.cyan(skill.name)} ${c.dim(`[${srcPath}] (forked subagent)`)}`,
            );
            writeln();
            const subagentPrompt = args
              ? `${loaded.content}\n\n${args}`
              : loaded.content;
            const result = await runForkedSkill(
              skill.name,
              subagentPrompt,
              ctx.cwd,
            );
            return { type: "inject-user-message", text: result };
          }

          writeln(
            `${PREFIX.info} ${c.cyan(skill.name)} ${c.dim(`[${srcPath}]`)}`,
          );
          writeln();
          const prompt = args ? `${loaded.content}\n\n${args}` : loaded.content;
          return { type: "inject-user-message", text: prompt };
        }
      }

      writeln(
        `${PREFIX.error} unknown: /${command}  ${c.dim("— /help for commands")}`,
      );
      return { type: "unknown", command };
    }
  }
}

// ─── Forked skill execution ──────────────────────────────────────────────────

async function runForkedSkill(
  skillName: string,
  prompt: string,
  cwd: string,
): Promise<string> {
  // Write prompt to a temp file to avoid shell argument length limits
  const tmpFile = join(
    tmpdir(),
    `mc-fork-${randomBytes(8).toString("hex")}.md`,
  );
  writeFileSync(tmpFile, prompt, "utf8");

  try {
    writeln(`${PREFIX.info} ${c.dim("running subagent…")}`);

    const proc = Bun.spawn([process.execPath, Bun.main], {
      cwd,
      stdin: Bun.file(tmpFile),
      env: {
        ...process.env,
        NO_COLOR: "1",
        FORCE_COLOR: "0",
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    if (exitCode !== 0 && !stdout.trim()) {
      return `[Subagent skill "${skillName}" failed (exit ${exitCode})]\n${stderr.trim()}`;
    }

    const output = stdout.trim();
    return `[Subagent result from skill "${skillName}"]\n\n${output}`;
  } finally {
    try {
      unlinkSync(tmpFile);
    } catch {
      /* best effort cleanup */
    }
  }
}

// ─── Config toggle commands ──────────────────────────────────────────────────

function handleBooleanToggleCommand(opts: {
  args: string;
  current: boolean;
  set: (value: boolean) => void;
  label: string;
  usage: string;
}): void {
  const mode = opts.args.trim().toLowerCase();
  if (!mode) {
    // Report current status when not toggling.
    writeln(
      `${PREFIX.success} ${opts.label} ${opts.current ? c.green("on") : c.dim("off")}`,
    );
    return;
  }

  if (mode === "on") {
    opts.set(true);
    writeln(`${PREFIX.success} ${opts.label} ${c.green("on")}`);
    return;
  }

  if (mode === "off") {
    opts.set(false);
    writeln(`${PREFIX.success} ${opts.label} ${c.dim("off")}`);
    return;
  }

  writeln(`${PREFIX.error} usage: ${opts.usage}`);
}

function handleReasoningCommand(ctx: CommandContext, args: string): void {
  handleBooleanToggleCommand({
    args,
    current: ctx.showReasoning,
    set: (value) => ctx.setShowReasoning(value),
    label: "reasoning display",
    usage: "/reasoning <on|off>",
  });
}

function handleVerboseCommand(ctx: CommandContext, args: string): void {
  handleBooleanToggleCommand({
    args,
    current: ctx.verboseOutput,
    set: (value) => ctx.setVerboseOutput(value),
    label: "verbose output",
    usage: "/verbose <on|off>",
  });
}
