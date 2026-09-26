import {
  getSupportedThinkingLevels,
  type Api,
  type AuthEvent,
  type AuthPrompt,
  type AuthType,
  type Model,
  type ModelThinkingLevel,
  type Models,
} from "@earendil-works/pi-ai";
import { saveConfig } from "../config.ts";
import { dim, red } from "./styles.ts";
import { commonPrefix } from "./complete.ts";

export interface CommandContext {
  /** The collection the running command may reach, e.g. to start a login. */
  models: Models;
  /** The model the session is currently running. */
  model: Model<Api>;
  /** Switches the running session to `model`. */
  select(model: Model<Api>): void;
  /** Sets the running session's thinking level. */
  setThinking(level: ModelThinkingLevel): void;
  /** Aborts when the running command is cancelled (Ctrl+C). */
  signal: AbortSignal;
  /** Appends already-styled lines to scrollback. */
  write(lines: string[]): void;
  /** Asks the user a question and resolves with the next submitted line. */
  prompt(prompt: AuthPrompt): Promise<string>;
  /** Reports a login event as styled scrollback lines. */
  notify(event: AuthEvent): void;
}

export interface Command {
  name: string; // no leading slash, lowercase
  description: string; // one line, shown by /help
  run(ctx: CommandContext, args: string): void | Promise<void>;
}

/** The keybindings the TUI accepts, in the order `/help` prints them. */
const KEYBINDINGS: [string, string][] = [
  ["Enter", "submit"],
  ["Shift+Enter", "newline (Ctrl+J also works)"],
  ["Esc", "pause the turn at the next step boundary"],
  ["Ctrl+C", "cancel the turn"],
  ["Ctrl+D", "exit on an empty draft"],
  ["Tab", "complete command or path"],
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

const login: Command = {
  name: "login",
  description: "authenticate a provider",
  async run(ctx, args): Promise<void> {
    const providers = ctx.models
      .getProviders()
      .filter((provider) => provider.auth.oauth?.login !== undefined || provider.auth.apiKey?.login !== undefined);
    const providerId =
      args.trim() ||
      (await ctx.prompt({
        type: "select",
        message: "Select a provider",
        options: providers.map((provider) => ({ id: provider.id, label: provider.name })),
      }));
    const provider = ctx.models.getProvider(providerId);
    if (provider === undefined) throw new Error(`unknown provider: ${providerId}`);

    const oauth = provider.auth.oauth;
    const apiKey = provider.auth.apiKey;
    const types: { id: AuthType; label: string }[] = [];
    if (oauth?.login !== undefined) {
      types.push({ id: "oauth", label: oauth.loginLabel ?? oauth.name });
    }
    if (apiKey?.login !== undefined) types.push({ id: "api_key", label: apiKey.name });
    if (types.length === 0) throw new Error(`provider "${providerId}" has no login flow`);
    const type =
      types.length === 1
        ? types[0].id
        : ((await ctx.prompt({
            type: "select",
            message: `How would you like to authenticate with ${provider.name}?`,
            options: types,
          })) as AuthType);

    try {
      await ctx.models.login(providerId, type, {
        signal: ctx.signal,
        prompt: (prompt) => ctx.prompt(prompt),
        notify: (event) => ctx.notify(event),
      });
    } catch (error) {
      if (ctx.signal.aborted) {
        ctx.write([red("! cancelled")]);
        return;
      }
      throw error;
    }
    const source = (await ctx.models.getAuth(providerId))?.source;
    ctx.write([`logged in to ${provider.name}${source === undefined ? "" : ` (${source})`}`]);
  },
};

const provider: Command = {
  name: "provider",
  description: "choose the provider and model",
  async run(ctx): Promise<void> {
    const available = await ctx.models.getAvailable(undefined, { signal: ctx.signal });
    const ids = [...new Set(available.map((m) => m.provider))];
    if (ids.length === 0) throw new Error("no authenticated providers");
    const providerId = await ctx.prompt({
      type: "select",
      message: "Select a provider",
      options: ids.map((id) => ({ id, label: ctx.models.getProvider(id)?.name ?? id })),
    });
    const models = available.filter((m) => m.provider === providerId);
    if (models.length === 0) throw new Error(`no models for provider "${providerId}"`);
    const name = ctx.models.getProvider(providerId)?.name ?? providerId;
    const modelId = await ctx.prompt({
      type: "select",
      message: `Select a model for ${name}`,
      options: models.map((m) => ({ id: m.id, label: m.name ?? m.id })),
    });
    const chosen = models.find((m) => m.id === modelId);
    if (chosen === undefined) throw new Error(`unknown model: ${modelId}`);
    saveConfig({ provider: providerId, model: modelId });
    ctx.select(chosen);
  },
};

const thinking: Command = {
  name: "thinking",
  description: "set the thinking level",
  async run(ctx): Promise<void> {
    const levels = getSupportedThinkingLevels(ctx.model);
    const level = (await ctx.prompt({
      type: "select",
      message: "Select a thinking level",
      options: levels.map((l) => ({ id: l, label: l })),
    })) as ModelThinkingLevel;
    saveConfig({ thinkingEffort: level });
    ctx.setThinking(level);
  },
};

const model: Command = {
  name: "model",
  description: "choose a model for the current provider",
  async run(ctx): Promise<void> {
    const providerId = ctx.model.provider;
    const models = await ctx.models.getAvailable(providerId, { signal: ctx.signal });
    if (models.length === 0) throw new Error(`no models for provider "${providerId}"`);
    const name = ctx.models.getProvider(providerId)?.name ?? providerId;
    const modelId = await ctx.prompt({
      type: "select",
      message: `Select a model for ${name}`,
      options: models.map((m) => ({ id: m.id, label: m.name ?? m.id })),
    });
    const chosen = models.find((m) => m.id === modelId);
    if (chosen === undefined) throw new Error(`unknown model: ${modelId}`);
    saveConfig({ provider: providerId, model: modelId });
    ctx.select(chosen);
  },
};

const COMMANDS: Command[] = [help, login, provider, model, thinking];

/** `/name` for a known `name`, else null; unknown slash text stays a message. */
export function findCommand(text: string): { command: Command; args: string } | null {
  const match = /^\/(\S+)(?:\s+([\s\S]*))?$/.exec(text);
  if (match === null) return null;
  const command = COMMANDS.find((candidate) => candidate.name === match[1]);
  return command === undefined ? null : { command, args: match[2] ?? "" };
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

