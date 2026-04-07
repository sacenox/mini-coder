/**
 * Entry point for mini-coder.
 *
 * Discovers available LLM providers, loads context (AGENTS.md, skills,
 * plugins), opens the session database, selects a model, and starts
 * the TUI.
 *
 * @module
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type {
  KnownProvider,
  Model,
  OAuthCredentials,
  ThinkingLevel,
  Tool,
} from "@mariozechner/pi-ai";
import { getEnvApiKey, getModels, getProviders } from "@mariozechner/pi-ai";
import { getOAuthApiKey, getOAuthProviders } from "@mariozechner/pi-ai/oauth";
import type { ToolHandler } from "./agent.ts";
import { type GitState, getGitState } from "./git.ts";
import { canonicalizePath } from "./paths.ts";
import {
  type AgentContext,
  destroyPlugins,
  initPlugins,
  type LoadedPlugin,
  loadPluginConfig,
} from "./plugins.ts";
import {
  type AgentsMdFile,
  buildSystemPrompt,
  discoverAgentsMd,
} from "./prompt.ts";
import {
  computeStats,
  filterModelMessages,
  type loadMessages,
  openDatabase,
  type Session,
  type SessionStats,
} from "./session.ts";
import {
  loadSettings,
  resolveStartupSettings,
  type UserSettings,
} from "./settings.ts";
import { discoverSkills, type Skill } from "./skills.ts";
import { DEFAULT_THEME, mergeThemes, type Theme } from "./theme.ts";
import {
  editTool,
  executeEdit,
  executeReadImage,
  executeShell,
  readImageTool,
  shellTool,
} from "./tools.ts";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** App data directory. */
const DATA_DIR = join(homedir(), ".config", "mini-coder");

/** SQLite database path. */
const DB_PATH = join(DATA_DIR, "mini-coder.db");

/** Plugin config file path. */
const PLUGIN_CONFIG_PATH = join(DATA_DIR, "plugins.json");

/** OAuth credentials file path. */
const AUTH_PATH = join(DATA_DIR, "auth.json");

/** User settings file path. */
const SETTINGS_PATH = join(DATA_DIR, "settings.json");

export { DEFAULT_SHOW_REASONING, DEFAULT_VERBOSE } from "./settings.ts";

/** Maximum sessions to keep per CWD. */
export const MAX_SESSIONS_PER_CWD = 20;

/** Maximum raw prompt-history entries to retain globally. */
export const MAX_PROMPT_HISTORY = 1_000;

// ---------------------------------------------------------------------------
// OAuth credential persistence
// ---------------------------------------------------------------------------

/** Load saved OAuth credentials from disk. */
function loadOAuthCredentials(): Record<string, OAuthCredentials> {
  if (!existsSync(AUTH_PATH)) return {};
  try {
    return JSON.parse(readFileSync(AUTH_PATH, "utf-8"));
  } catch {
    return {};
  }
}

/** Save OAuth credentials to disk. */
function saveOAuthCredentials(creds: Record<string, OAuthCredentials>): void {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(AUTH_PATH, JSON.stringify(creds, null, 2), "utf-8");
}

// ---------------------------------------------------------------------------
// Provider discovery
// ---------------------------------------------------------------------------

/** Result of provider discovery: available providers + OAuth state. */
interface DiscoveryResult {
  /** Provider → API key map for all ready-to-use providers. */
  providers: Map<string, string>;
  /** OAuth credentials (possibly refreshed during discovery). */
  oauthCredentials: Record<string, OAuthCredentials>;
}

/**
 * Discover which providers have usable credentials.
 *
 * Checks env-based API keys first, then saved OAuth tokens. Refreshes
 * expired OAuth tokens and persists updated credentials.
 */
async function discoverProviders(): Promise<DiscoveryResult> {
  const providers = new Map<string, string>();

  // 1. Check env-based API keys
  for (const provider of getProviders()) {
    const key = getEnvApiKey(provider);
    if (key) {
      providers.set(provider, key);
    }
  }

  // 2. Check OAuth credentials
  const oauthCredentials = loadOAuthCredentials();
  let credsModified = false;

  for (const oauthProvider of getOAuthProviders()) {
    // Skip if already available via env key
    if (providers.has(oauthProvider.id)) continue;

    try {
      const result = await getOAuthApiKey(oauthProvider.id, oauthCredentials);
      if (result) {
        providers.set(oauthProvider.id, result.apiKey);
        // Update credentials if they were refreshed
        if (result.newCredentials !== oauthCredentials[oauthProvider.id]) {
          oauthCredentials[oauthProvider.id] = result.newCredentials;
          credsModified = true;
        }
      }
    } catch {
      // Token refresh failed — skip this provider
    }
  }

  if (credsModified) {
    saveOAuthCredentials(oauthCredentials);
  }

  return { providers, oauthCredentials };
}

// ---------------------------------------------------------------------------
// Model selection
// ---------------------------------------------------------------------------

/**
 * List all models from authenticated providers.
 *
 * @param availableProviders - Providers with usable credentials.
 * @returns Flat list of available models.
 */
function listAvailableModels(
  availableProviders: Map<string, string>,
): Model<string>[] {
  const result: Model<string>[] = [];
  for (const provider of availableProviders.keys()) {
    const models = getModels(provider as KnownProvider);
    for (const model of models) {
      result.push(model);
    }
  }
  return result;
}

/**
 * Select a model by id from the available model list.
 *
 * @param models - Available models.
 * @param modelId - Preferred provider/model identifier.
 * @returns Matching model, or `null` when none is selected.
 */
function selectModel(
  models: readonly Model<string>[],
  modelId: string | null,
): Model<string> | null {
  if (modelId == null) {
    return null;
  }
  return (
    models.find((model) => `${model.provider}/${model.id}` === modelId) ?? null
  );
}

// ---------------------------------------------------------------------------
// Tool wiring
// ---------------------------------------------------------------------------

/** Built-in tool handlers keyed by tool name. */
const BUILTIN_HANDLERS: Record<string, ToolHandler> = {
  edit: (args, cwd) =>
    executeEdit(
      {
        path: args.path as string,
        oldText: args.oldText as string,
        newText: args.newText as string,
      },
      cwd,
    ),
  shell: (args, cwd, signal, onUpdate) =>
    executeShell({ command: args.command as string }, cwd, {
      ...(signal ? { signal } : {}),
      ...(onUpdate ? { onUpdate } : {}),
    }),
  readImage: (args, cwd) =>
    executeReadImage({ path: args.path as string }, cwd),
};

/**
 * Build tool definitions and handler map for the current model.
 *
 * Returns the `Tool[]` to send to the model and the handler map
 * for the agent loop to dispatch tool calls.
 */
function buildTools(
  model: Model<string>,
  plugins: LoadedPlugin[],
): { tools: Tool[]; toolHandlers: Map<string, ToolHandler> } {
  const tools: Tool[] = [editTool, shellTool];
  const toolHandlers = new Map<string, ToolHandler>([
    [editTool.name, BUILTIN_HANDLERS.edit!],
    [shellTool.name, BUILTIN_HANDLERS.shell!],
  ]);

  // Conditionally register readImage for vision-capable models
  if (model.input.includes("image")) {
    tools.push(readImageTool);
    toolHandlers.set(readImageTool.name, BUILTIN_HANDLERS.readImage!);
  }

  // Add plugin tools
  for (const plugin of plugins) {
    if (plugin.result.tools) {
      for (const tool of plugin.result.tools) {
        tools.push(tool);
      }
    }
    if (plugin.result.toolHandlers) {
      for (const [name, handler] of plugin.result.toolHandlers) {
        toolHandlers.set(name, handler);
      }
    }
  }

  return { tools, toolHandlers };
}

// ---------------------------------------------------------------------------
// Skill scan paths
// ---------------------------------------------------------------------------

/** Build the list of skill scan paths per the spec. */
function getSkillScanPaths(cwd: string, gitRoot: string | null): string[] {
  const home = homedir();
  const project = gitRoot ?? cwd;
  return [
    join(project, ".mini-coder", "skills"),
    join(project, ".agents", "skills"),
    join(home, ".mini-coder", "skills"),
    join(home, ".agents", "skills"),
  ];
}

// ---------------------------------------------------------------------------
// App state
// ---------------------------------------------------------------------------

/** All mutable application state in one place. */
export interface AppState {
  /** Open database handle. */
  db: ReturnType<typeof openDatabase>;
  /** Current session, created lazily on the first user message. */
  session: Session | null;
  /** Current model, or `null` if no providers are available yet. */
  model: Model<string> | null;
  /** Current effort level. */
  effort: ThinkingLevel;
  /** Message history for the active session. */
  messages: ReturnType<typeof loadMessages>;
  /** Cumulative session input/output/cost stats for the status bar. */
  stats: SessionStats;
  /** Discovered AGENTS.md files. */
  agentsMd: AgentsMdFile[];
  /** Discovered skills. */
  skills: Skill[];
  /** Loaded plugins. */
  plugins: LoadedPlugin[];
  /** Active theme (default + plugin overrides). */
  theme: Theme;
  /** Current git state (null if not in a repo). */
  git: GitState | null;
  /** Available provider credentials (provider → API key). */
  providers: Map<string, string>;
  /** OAuth credentials on disk. */
  oauthCredentials: Record<string, OAuthCredentials>;
  /** Loaded global user settings. */
  settings: UserSettings;
  /** Absolute path to the global settings file. */
  settingsPath: string;
  /** Working directory as entered by the user/shell (for display and tool execution). */
  cwd: string;
  /** Canonical working directory (for path identity and session scoping). */
  canonicalCwd: string;
  /** Whether the agent loop is currently running. */
  running: boolean;
  /** Abort controller for the current agent run. */
  abortController: AbortController | null;
  /** Whether to show thinking content. */
  showReasoning: boolean;
  /** Whether to show full (un-truncated) tool output. */
  verbose: boolean;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/** Initialize and return the full app state. */
export async function init(): Promise<AppState> {
  const cwd = process.cwd();
  const canonicalCwd = canonicalizePath(cwd);

  // Ensure data directory exists
  mkdirSync(DATA_DIR, { recursive: true });

  // Discover providers (env + OAuth)
  const { providers, oauthCredentials } = await discoverProviders();

  // Load user settings and resolve startup defaults
  const settings = loadSettings(SETTINGS_PATH);
  const availableModels = listAvailableModels(providers);
  const startup = resolveStartupSettings(
    settings,
    availableModels.map((model) => `${model.provider}/${model.id}`),
  );
  const model = selectModel(availableModels, startup.modelId);

  // Gather git state
  const git = await getGitState(cwd);
  const gitRoot = git?.root ?? null;

  // Discover context
  const home = homedir();
  const scanRoot = gitRoot ?? home;
  const agentsMd = discoverAgentsMd(cwd, scanRoot, join(home, ".agents"));
  const skills = discoverSkills(getSkillScanPaths(canonicalCwd, gitRoot));

  // Load plugins
  const pluginEntries = loadPluginConfig(PLUGIN_CONFIG_PATH);

  // Open database. Sessions are created lazily on the first user message.
  const db = openDatabase(DB_PATH);
  const effort = startup.effort;
  const messages: ReturnType<typeof loadMessages> = [];
  const stats = computeStats(messages);

  // Init plugins
  const context: AgentContext = {
    cwd,
    messages: filterModelMessages(messages),
    dataDir: DATA_DIR,
  };
  const plugins = await initPlugins(pluginEntries, context, (entry, err) => {
    console.error(`Plugin "${entry.name}" failed to init: ${err.message}`);
  });

  // Build theme from defaults + plugin overrides
  const themeOverrides = plugins
    .map((p) => p.result.theme)
    .filter((t): t is Partial<Theme> => t != null);
  const theme = mergeThemes(DEFAULT_THEME, ...themeOverrides);

  return {
    db,
    session: null,
    model,
    effort,
    messages,
    stats,
    agentsMd,
    skills,
    plugins,
    theme,
    git,
    providers,
    oauthCredentials,
    settings,
    settingsPath: SETTINGS_PATH,
    cwd,
    canonicalCwd,
    running: false,
    abortController: null,
    showReasoning: startup.showReasoning,
    verbose: startup.verbose,
  };
}

/**
 * Build the system prompt for the current state.
 *
 * Separated from `init` because it's called on every turn (git state
 * may change between turns).
 */
export function buildPrompt(state: AppState): string {
  return buildSystemPrompt({
    cwd: state.cwd,
    date: new Date().toISOString().slice(0, 10),
    git: state.git,
    agentsMd: state.agentsMd,
    skills: state.skills,
    pluginSuffixes: state.plugins
      .map((p) => p.result.systemPromptSuffix)
      .filter((s): s is string => s != null),
  });
}

/** Build the tool list for the current model. */
export function buildToolList(state: AppState): {
  tools: Tool[];
  toolHandlers: Map<string, ToolHandler>;
} {
  if (!state.model) return { tools: [], toolHandlers: new Map() };
  return buildTools(state.model, state.plugins);
}

/**
 * Get all models from authenticated providers.
 *
 * Returns a flat list of models from providers the user has credentials
 * for, suitable for the `/model` selector.
 */
export function getAvailableModels(state: AppState): Model<string>[] {
  return listAvailableModels(state.providers);
}

/** Clean up resources on shutdown. */
export async function shutdown(state: AppState): Promise<void> {
  await destroyPlugins(state.plugins, (entry, err) => {
    console.error(`Plugin "${entry.name}" failed to destroy: ${err.message}`);
  });
  state.db.close();
}

// ---------------------------------------------------------------------------
// OAuth helpers (re-exported for /login and /logout commands)
// ---------------------------------------------------------------------------

export {
  AUTH_PATH,
  DATA_DIR,
  loadOAuthCredentials,
  SETTINGS_PATH,
  saveOAuthCredentials,
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/**
 * Start the mini-coder CLI.
 *
 * Initializes application state and launches the TUI.
 *
 * @returns A promise that resolves once startup is complete.
 */
export async function main(): Promise<void> {
  const state = await init();
  const { startUI } = await import("./ui.ts");
  startUI(state);
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
