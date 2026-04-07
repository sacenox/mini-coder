/**
 * `/help` text rendering and command descriptions for the terminal UI.
 *
 * @module
 */

import type { AppState } from "../index.ts";
import { COMMANDS } from "../input.ts";
import { abbreviatePath } from "./status.ts";

/** Help text inputs derived from application state. */
export interface HelpRenderState {
  /** Available provider credentials keyed by provider id. */
  providers: AppState["providers"];
  /** Current model selection. */
  model: AppState["model"];
  /** Loaded AGENTS.md files. */
  agentsMd: AppState["agentsMd"];
  /** Discovered skills. */
  skills: AppState["skills"];
  /** Active plugins. */
  plugins: AppState["plugins"];
  /** Whether reasoning blocks are shown in the log. */
  showReasoning: AppState["showReasoning"];
  /** Whether full tool output is shown in the log. */
  verbose: AppState["verbose"];
}

/** Command descriptions for `/help` and command autocomplete. */
export const COMMAND_DESCRIPTIONS: Record<string, string> = {
  model: "Select a model",
  effort: "Set reasoning effort",
  session: "Resume a session",
  new: "New session",
  fork: "Fork session",
  undo: "Undo last turn",
  reasoning: "Toggle thinking display",
  verbose: "Toggle full output",
  login: "OAuth login",
  logout: "OAuth logout",
  help: "Show help",
};

/**
 * Get the `/help` description for a command, including current state when relevant.
 *
 * @param command - Command name.
 * @param state - Help-relevant application state.
 * @returns Human-readable command description.
 */
function getHelpCommandDescription(
  command: (typeof COMMANDS)[number],
  state: Pick<HelpRenderState, "showReasoning" | "verbose">,
): string {
  const description = COMMAND_DESCRIPTIONS[command] ?? "";
  if (command === "reasoning") {
    return `${description} (currently ${state.showReasoning ? "on" : "off"})`;
  }
  if (command === "verbose") {
    return `${description} (currently ${state.verbose ? "on" : "off"})`;
  }
  return description;
}

/**
 * Build the `/help` text shown in the conversation log.
 *
 * @param state - Help-relevant application state.
 * @returns Multi-line help text for display.
 */
export function buildHelpText(state: HelpRenderState): string {
  const lines: string[] = [];

  lines.push("Commands:");
  for (const command of COMMANDS) {
    lines.push(`  /${command}  ${getHelpCommandDescription(command, state)}`);
  }

  const providerNames = Array.from(state.providers.keys());
  lines.push("");
  lines.push(
    providerNames.length > 0
      ? `Providers: ${providerNames.join(", ")}`
      : "Providers: none (use /login)",
  );

  lines.push(
    state.model
      ? `Model: ${state.model.provider}/${state.model.id}`
      : "Model: none (use /model)",
  );

  if (state.agentsMd.length > 0) {
    lines.push("");
    lines.push("AGENTS.md files:");
    for (const agentFile of state.agentsMd) {
      lines.push(`  ${abbreviatePath(agentFile.path)}`);
    }
  }

  if (state.skills.length > 0) {
    lines.push("");
    lines.push("Skills:");
    for (const skill of state.skills) {
      const description = skill.description ? `  ${skill.description}` : "";
      lines.push(`  ${skill.name}${description}`);
    }
  }

  if (state.plugins.length > 0) {
    lines.push("");
    lines.push("Plugins:");
    for (const plugin of state.plugins) {
      lines.push(`  ${plugin.entry.name}`);
    }
  }

  return lines.join("\n");
}
