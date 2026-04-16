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
  /** Whether verbose tool rendering is enabled in the log. */
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
  verbose: "Toggle verbose tool rendering",
  todo: "Show the current todo list",
  login: "OAuth login",
  logout: "OAuth logout",
  help: "Show help",
};

/**
 * Get the `/help` description for a command, including current state when relevant.
 *
 * @param command - Command name.
 * @param state - Help-relevant application state.
 * @returns Markdown-ready command description.
 */
function getHelpCommandDescription(
  command: (typeof COMMANDS)[number],
  state: Pick<HelpRenderState, "showReasoning" | "verbose">,
): string {
  const description = COMMAND_DESCRIPTIONS[command] ?? "";
  if (command === "reasoning") {
    return `${description} _(currently ${state.showReasoning ? "on" : "off"})_`;
  }
  if (command === "verbose") {
    return `${description} _(currently ${state.verbose ? "on" : "off"})_`;
  }
  return description;
}

function formatInlineCode(text: string): string {
  return `\`${text}\``;
}

function formatInlineCodeList(items: readonly string[]): string {
  return items.map((item) => formatInlineCode(item)).join(", ");
}

/**
 * Build the `/help` text shown in the conversation log.
 *
 * @param state - Help-relevant application state.
 * @returns Multi-line markdown help text for display.
 */
export function buildHelpText(state: HelpRenderState): string {
  const lines: string[] = ["# Help", "", "## Commands", ""];

  for (const command of COMMANDS) {
    lines.push(
      `- ${formatInlineCode(`/${command}`)} — ${getHelpCommandDescription(command, state)}`,
    );
  }

  const providerNames = Array.from(state.providers.keys());
  lines.push(
    "",
    "## Keyboard",
    "",
    "- `Enter` submits the current draft.",
    "- `Shift+Enter` inserts a newline.",
    "- `Tab` opens command autocomplete when the draft starts with `/`.",
    "- Otherwise, `Tab` autocompletes file paths and can open a path picker when there are multiple matches.",
    "- `Ctrl+R` opens global input history search.",
    "- `Escape` closes the current overlay and returns focus to the input.",
    "- With no overlay open, `Escape` interrupts the current turn.",
    "- Otherwise, `Escape` does nothing.",
    "- `Ctrl+C` exits gracefully.",
    "- `Ctrl+D` exits when the input is empty.",
    "- `Ctrl+Z` suspends the app to the background.",
    "",
    "## Current state",
    "",
    providerNames.length > 0
      ? `- Providers: ${formatInlineCodeList(providerNames)}`
      : "- Providers: none — use `/login`",
    state.model
      ? `- Model: ${formatInlineCode(`${state.model.provider}/${state.model.id}`)}`
      : "- Model: none — use `/model`",
  );

  if (state.agentsMd.length > 0) {
    lines.push("", "## Loaded `AGENTS.md` files", "");
    for (const agentFile of state.agentsMd) {
      lines.push(`- ${formatInlineCode(abbreviatePath(agentFile.path))}`);
    }
  }

  if (state.skills.length > 0) {
    lines.push("", "## Skills", "");
    for (const skill of state.skills) {
      lines.push(
        skill.description
          ? `- ${formatInlineCode(skill.name)} — ${skill.description}`
          : `- ${formatInlineCode(skill.name)}`,
      );
    }
  }

  if (state.plugins.length > 0) {
    lines.push("", "## Plugins", "");
    for (const plugin of state.plugins) {
      lines.push(`- ${formatInlineCode(plugin.entry.name)}`);
    }
  }

  return lines.join("\n");
}
