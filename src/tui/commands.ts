import { dim } from "./styles.ts";
import { commonPrefix } from "./complete.ts";

export interface CommandContext {
  /** Appends already-styled lines to scrollback. */
  write(lines: string[]): void;
}

interface Command {
  name: string; // no leading slash, lowercase
  description: string; // one line, shown by /help
  run(ctx: CommandContext): void;
}

/** The keybindings the TUI accepts, in the order `/help` prints them. */
const KEYBINDINGS: [string, string][] = [
  ["Enter", "submit"],
  ["Shift+Enter", "newline (Ctrl+J also works)"],
  ["Esc", "pause the turn at the next step boundary"],
  ["Ctrl+C", "cancel the turn"],
  ["Ctrl+D", "exit on an empty draft"],
  ["Tab", "complete path (after command completion)"],
];

/** One aligned `key  description` block; the key column is dimmed. */
function keyed(rows: [string, string][], width: number): string[] {
  return rows.map(([key, description]) => `  ${dim(key.padEnd(width))}  ${description}`);
}

const help: Command = {
  name: "help",
  description: "list commands and keybindings",
  run(ctx): void {
    const names = COMMANDS.map((command): [string, string] => [`/${command.name}`, command.description]);
    const width = Math.max(...names.map(([key]) => key.length), ...KEYBINDINGS.map(([key]) => key.length));
    ctx.write(["commands", ...keyed(names, width), "", "keybindings", ...keyed(KEYBINDINGS, width)]);
  },
};

const COMMANDS: Command[] = [help];

/** `/name` for a known `name`, else null; unknown slash text stays a message. */
export function findCommand(text: string): Command | null {
  const match = /^\/(\S+)/.exec(text);
  return match === null ? null : (COMMANDS.find((candidate) => candidate.name === match[1]) ?? null);
}

/** Tab completion for a half-typed command name; null leaves the draft alone. */
export function completeCommand(draft: string): string | null {
  if (!draft.startsWith("/") || /\s/.test(draft)) return null;
  const typed = draft.slice(1);
  const matches = COMMANDS.filter((command) => command.name.startsWith(typed));
  if (matches.length === 0) return null;
  if (matches.length === 1) return `/${matches[0].name}`;
  const shared = matches.map((command) => command.name).reduce(commonPrefix);
  return shared === typed ? null : `/${shared}`;
}

