/**
 * Entry point for mini-coder.
 *
 * Discovers available LLM providers, loads configured MCP tools,
 * loads prompt context (AGENTS.md, skills, and theme), opens the session
 * database, selects a model, and starts the TUI.
 *
 * @module
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import type {
  KnownProvider,
  Model,
  OAuthCredentials,
  ThinkingLevel,
  Tool,
  UserMessage,
} from "@mariozechner/pi-ai";
import { getEnvApiKey, getModels, getProviders } from "@mariozechner/pi-ai";
import { getOAuthApiKey, getOAuthProviders } from "@mariozechner/pi-ai/oauth";
import type { ToolHandler } from "./agent.ts";
import {
  type CliOptions,
  parseCliArgs,
  resolveHeadlessPrompt,
  shouldUseHeadlessMode,
  type TtyState,
} from "./cli.ts";
import { getErrorMessage } from "./errors.ts";
import { type GitState, getGitState } from "./git.ts";
import { discoverMcpServers, type McpServerState } from "./mcp.ts";
import { canonicalizePath } from "./paths.ts";
import {
  type AgentsMdFile,
  buildSystemPrompt,
  discoverAgentsMd,
  resolveAgentsScanRoot,
} from "./prompt.ts";
import {
  appendMessage,
  createConversationSnapshot,
  createSession,
  type loadMessages,
  openDatabase,
  type Session,
  type SessionStats,
  truncateSessions,
} from "./session.ts";
import {
  type CustomProvider,
  loadStartupSettings,
  mergeUserSettings,
  resolveStartupSettings,
  type UserSettings,
} from "./settings.ts";
import { discoverSkills, type Skill } from "./skills.ts";
import { DEFAULT_THEME, type Theme } from "./theme.ts";
import {
  createTodoReadToolHandler,
  createTodoWriteToolHandler,
  editTool,
  editToolHandler,
  grepTool,
  grepToolHandler,
  readImageTool,
  readImageToolHandler,
  readTool,
  readToolHandler,
  shellTool,
  shellToolHandler,
  todoReadTool,
  todoWriteTool,
} from "./tools.ts";
import { resolveAppVersionLabel } from "./version.ts";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** App data directory. */
const DATA_DIR = join(homedir(), ".config", "mini-coder");

/** SQLite database path. */
const DB_PATH = join(DATA_DIR, "mini-coder.db");

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
function loadOAuthCredentials(
  path = AUTH_PATH,
): Record<string, OAuthCredentials> {
  if (!existsSync(path)) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf-8")) as unknown;
  } catch (error) {
    throw new Error(
      `Failed to read OAuth credentials ${path}: ${getErrorMessage(error)}`,
    );
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(
      `Failed to read OAuth credentials ${path}: expected a JSON object`,
    );
  }

  return parsed as Record<string, OAuthCredentials>;
}

/** Save OAuth credentials to disk. */
function saveOAuthCredentials(
  creds: Record<string, OAuthCredentials>,
  path = AUTH_PATH,
): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(creds, null, 2), "utf-8");
}

/** Return whether refreshed OAuth credentials differ from the persisted value. */
export function didOAuthCredentialsChange(
  current: OAuthCredentials | undefined,
  next: OAuthCredentials,
): boolean {
  return !isDeepStrictEqual(current, next);
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
        if (
          didOAuthCredentialsChange(
            oauthCredentials[oauthProvider.id],
            result.newCredentials,
          )
        ) {
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
// Custom provider discovery
// ---------------------------------------------------------------------------

/** Timeout for custom provider model discovery requests. */
const CUSTOM_PROVIDER_TIMEOUT_MS = 3_000;

/** Default API key for custom providers that don't require authentication. */
const CUSTOM_PROVIDER_DEFAULT_KEY = "no-key";

/** Result of custom provider discovery. */
interface CustomDiscoveryResult {
  /** Discovered models from all reachable custom providers. */
  models: Model<"openai-completions">[];
  /** Provider name → API key for discovered providers. */
  providers: Map<string, string>;
  /** Warning messages for unreachable or invalid providers. */
  warnings: string[];
}

/**
 * Discover models from user-configured OpenAI-compatible endpoints.
 *
 * Queries each provider's `/models` endpoint and constructs pi-ai Model
 * objects from the response. Unreachable endpoints produce a warning
 * instead of failing startup.
 *
 * @param customProviders - Configured custom provider entries.
 * @param builtInProviderNames - Names of built-in providers (to detect collisions).
 * @returns Discovered models, provider credentials, and warnings.
 */
export async function discoverCustomProviders(
  customProviders: readonly CustomProvider[],
  builtInProviderNames: ReadonlySet<string>,
): Promise<CustomDiscoveryResult> {
  const models: Model<"openai-completions">[] = [];
  const providers = new Map<string, string>();
  const warnings: string[] = [];

  for (const entry of customProviders) {
    if (builtInProviderNames.has(entry.name)) {
      warnings.push(
        `Custom provider "${entry.name}" skipped: name conflicts with a built-in provider.`,
      );
      continue;
    }

    const apiKey = entry.apiKey ?? CUSTOM_PROVIDER_DEFAULT_KEY;
    const modelsUrl = `${entry.baseUrl}/models`;

    try {
      const response = await fetch(modelsUrl, {
        signal: AbortSignal.timeout(CUSTOM_PROVIDER_TIMEOUT_MS),
      });

      if (!response.ok) {
        warnings.push(
          `Custom provider "${entry.name}": ${response.status} ${response.statusText} (${modelsUrl})`,
        );
        continue;
      }

      const body = (await response.json()) as {
        data?: { id: string }[];
      };
      const modelList = body.data ?? [];

      for (const item of modelList) {
        if (typeof item.id !== "string" || !item.id) continue;

        models.push({
          id: item.id,
          name: item.id,
          api: "openai-completions",
          provider: entry.name,
          baseUrl: entry.baseUrl,
          reasoning: false,
          input: ["text"],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 131072,
          maxTokens: 8192,
        });
      }

      providers.set(entry.name, apiKey);
    } catch (error) {
      warnings.push(
        `Custom provider "${entry.name}": ${getErrorMessage(error)} (${modelsUrl})`,
      );
    }
  }

  return { models, providers, warnings };
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

/**
 * Build tool definitions and handler map for the current model.
 *
 * Returns the `Tool[]` to send to the model and the handler map
 * for the agent loop to dispatch tool calls.
 */
function buildTools(
  model: Model<string>,
  messages: AppState["messages"],
  mcpServers: readonly McpServerState[],
): { tools: Tool[]; toolHandlers: Map<string, ToolHandler> } {
  const tools: Tool[] = [
    shellTool,
    readTool,
    grepTool,
    editTool,
    todoWriteTool,
    todoReadTool,
  ];
  const toolHandlers = new Map<string, ToolHandler>([
    [shellTool.name, shellToolHandler],
    [readTool.name, readToolHandler],
    [grepTool.name, grepToolHandler],
    [editTool.name, editToolHandler],
    [todoWriteTool.name, createTodoWriteToolHandler(messages)],
    [todoReadTool.name, createTodoReadToolHandler(messages)],
  ]);

  for (const server of mcpServers) {
    if (!server.enabled || !server.connected) {
      continue;
    }

    tools.push(...server.tools);
    for (const [name, handler] of server.toolHandlers) {
      toolHandlers.set(name, handler);
    }
  }

  // Conditionally register readImage for vision-capable models
  if (model.input.includes("image")) {
    tools.push(readImageTool);
    toolHandlers.set(readImageTool.name, readImageToolHandler);
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

/** Load AGENTS.md files, skills, git state, and the active theme. */
export async function loadPromptContext(opts?: { cwd?: string }): Promise<{
  cwd: string;
  canonicalCwd: string;
  git: GitState | null;
  agentsMd: AgentsMdFile[];
  skills: Skill[];
  theme: Theme;
}> {
  const cwd = opts?.cwd ?? process.cwd();
  const canonicalCwd = canonicalizePath(cwd);
  const git = await getGitState(cwd);
  const gitRoot = git?.root ?? null;
  const home = homedir();
  const scanRoot = resolveAgentsScanRoot(
    cwd,
    gitRoot,
    home,
    process.env.MC_AGENTS_ROOT,
  );
  const agentsMd = discoverAgentsMd(cwd, scanRoot, join(home, ".agents"));
  const skills = discoverSkills(getSkillScanPaths(canonicalCwd, gitRoot));

  return {
    cwd,
    canonicalCwd,
    git,
    agentsMd,
    skills,
    theme: DEFAULT_THEME,
  };
}

/**
 * Load global and repo-local settings for the current launch.
 *
 * The repo-local overlay is read only and is loaded only when a git root is
 * known. Invalid startup content in either file is treated as empty settings.
 *
 * @param opts - Optional settings path and git-root override for tests.
 * @returns Global settings, repo-local overlay settings, and the merged result.
 */
export function loadUserSettingsForLaunch(opts?: {
  settingsPath?: string;
  gitRoot?: string | null;
}): {
  settings: UserSettings;
  repoSettings: UserSettings;
  effectiveSettings: UserSettings;
} {
  const settingsPath = opts?.settingsPath ?? SETTINGS_PATH;
  const gitRoot = opts?.gitRoot ?? null;
  const settings = loadStartupSettings(settingsPath);
  const repoSettings = gitRoot
    ? loadStartupSettings(join(gitRoot, ".mini-coder", "settings.json"))
    : {};

  return {
    settings,
    repoSettings,
    effectiveSettings: mergeUserSettings(settings, repoSettings),
  };
}

/** Refresh the current prompt/session context at a reload boundary like `/new`. */
export async function reloadPromptContext(
  state: AppState,
  runtime?: {
    loadPromptContext?: typeof loadPromptContext;
  },
): Promise<void> {
  const loadContext = runtime?.loadPromptContext ?? loadPromptContext;
  const context = await loadContext();

  state.cwd = context.cwd;
  state.canonicalCwd = context.canonicalCwd;
  state.git = context.git;
  state.agentsMd = context.agentsMd;
  state.skills = context.skills;
  state.theme = context.theme;
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
  /** Estimated model-visible context tokens for the next request. */
  contextTokens: number;
  /** Discovered AGENTS.md files. */
  agentsMd: AgentsMdFile[];
  /** Discovered skills. */
  skills: Skill[];
  /** Active theme. */
  theme: Theme;
  /** Version label shown in the empty conversation banner. */
  versionLabel: string;
  /** Current git state (null if not in a repo). */
  git: GitState | null;
  /** Available provider credentials (provider → API key). */
  providers: Map<string, string>;
  /** OAuth credentials on disk. */
  oauthCredentials: Record<string, OAuthCredentials>;
  /** Loaded global user settings. */
  settings: UserSettings;
  /** Loaded repo-local settings overlay for the current app run. */
  repoSettings: UserSettings;
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
  /** Promise for the active conversational turn, used to serialize cleanup like `/undo`. */
  activeTurnPromise: Promise<void> | null;
  /** Resolved user messages queued while the current run is still active. */
  queuedUserMessages: UserMessage[];
  /** Whether to show thinking content. */
  showReasoning: boolean;
  /** Whether to show full (un-truncated) tool output. */
  verbose: boolean;
  /** Configured MCP servers, including their current enabled/disabled state. */
  mcpServers: McpServerState[];
  /** Models discovered from custom OpenAI-compatible providers. */
  customModels: Model<string>[];
  /** Warnings from startup (e.g. unreachable custom providers or MCP servers). */
  startupWarnings: string[];
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/** Initialize and return the full app state. */
export async function init(): Promise<AppState> {
  const cwd = process.cwd();

  // Ensure data directory exists
  mkdirSync(DATA_DIR, { recursive: true });

  // Discover providers (env + OAuth)
  const { providers, oauthCredentials } = await discoverProviders();

  const promptContext = await loadPromptContext({ cwd });
  const { settings, repoSettings, effectiveSettings } =
    loadUserSettingsForLaunch({
      settingsPath: SETTINGS_PATH,
      gitRoot: promptContext.git?.root ?? null,
    });

  // Discover custom providers from effective settings
  const builtInProviderNames = new Set(providers.keys());
  const customResult = await discoverCustomProviders(
    effectiveSettings.customProviders ?? [],
    builtInProviderNames,
  );

  // Merge custom provider credentials
  for (const [name, key] of customResult.providers) {
    providers.set(name, key);
  }

  const mcpResult = await discoverMcpServers(effectiveSettings.mcp);

  const builtInModels = listAvailableModels(providers);
  const availableModels = [...builtInModels, ...customResult.models];
  const startup = resolveStartupSettings(
    effectiveSettings,
    availableModels.map((model) => `${model.provider}/${model.id}`),
  );
  const model = selectModel(availableModels, startup.modelId);

  // Open database. Sessions are created lazily on the first user message.
  const db = openDatabase(DB_PATH);
  const effort = startup.effort;
  const conversation = createConversationSnapshot();

  return {
    db,
    session: null,
    model,
    effort,
    messages: conversation.messages,
    stats: conversation.stats,
    contextTokens: conversation.contextTokens,
    agentsMd: promptContext.agentsMd,
    skills: promptContext.skills,
    theme: promptContext.theme,
    versionLabel: resolveAppVersionLabel(),
    git: promptContext.git,
    providers,
    oauthCredentials,
    settings,
    repoSettings,
    settingsPath: SETTINGS_PATH,
    cwd: promptContext.cwd,
    canonicalCwd: promptContext.canonicalCwd,
    running: false,
    abortController: null,
    activeTurnPromise: null,
    queuedUserMessages: [],
    showReasoning: startup.showReasoning,
    verbose: startup.verbose,
    mcpServers: mcpResult.servers,
    customModels: customResult.models,
    startupWarnings: [...customResult.warnings, ...mcpResult.warnings],
  };
}

/** Resolve the shell label shown in the system prompt. */
function resolvePromptShell(): string {
  return basename(process.env.SHELL || "/bin/sh");
}

/** Resolve the normalized OS label shown in the system prompt. */
function resolvePromptOs(): "linux" | "mac" | "docker" {
  if (process.platform === "darwin") {
    return "mac";
  }
  if (existsSync("/.dockerenv") || existsSync("/run/.containerenv")) {
    return "docker";
  }
  return "linux";
}

/**
 * Build the system prompt for the current state.
 *
 * Separated from `init` because turns still rebuild the assembled prompt
 * from the session-stable prompt context plus the current runtime state.
 */
export function buildPrompt(state: AppState): string {
  return buildSystemPrompt({
    cwd: state.cwd,
    modelLabel: state.model
      ? `${state.model.provider}/${state.model.id}`
      : "unknown",
    os: resolvePromptOs(),
    shell: resolvePromptShell(),
    supportsImages: state.model?.input.includes("image") ?? false,
    git: state.git,
    agentsMd: state.agentsMd,
    skills: state.skills,
  });
}

/** Build the tool list for the current model. */
export function buildToolList(state: AppState): {
  tools: Tool[];
  toolHandlers: Map<string, ToolHandler>;
} {
  if (!state.model) return { tools: [], toolHandlers: new Map() };
  return buildTools(state.model, state.messages, state.mcpServers);
}

/**
 * Ensure the app has an active persisted session.
 *
 * Creates the session lazily on the first submitted prompt and backfills any
 * already-present messages into the new session.
 *
 * @param state - Application state.
 * @returns The active persisted session.
 */
export function ensureSession(
  state: AppState,
): NonNullable<AppState["session"]> {
  if (state.session) {
    return state.session;
  }

  const modelLabel = state.model
    ? `${state.model.provider}/${state.model.id}`
    : undefined;
  const session = createSession(state.db, {
    cwd: state.canonicalCwd,
    model: modelLabel,
    effort: state.effort,
  });
  truncateSessions(state.db, state.canonicalCwd, MAX_SESSIONS_PER_CWD);
  state.session = session;

  for (const message of state.messages) {
    appendMessage(state.db, session.id, message);
  }

  return session;
}

/**
 * Get all models from authenticated providers.
 *
 * Returns a flat list of models from providers the user has credentials
 * for, suitable for the `/model` selector.
 */
export function getAvailableModels(state: AppState): Model<string>[] {
  return [...listAvailableModels(state.providers), ...state.customModels];
}

/** Clean up resources on shutdown. */
export async function shutdown(state: AppState): Promise<void> {
  await Promise.allSettled(state.mcpServers.map((server) => server.close()));
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
// Headless CLI
// ---------------------------------------------------------------------------

type HeadlessCliStopReason = "stop" | "length" | "error" | "aborted";

/**
 * Run one headless CLI prompt using the output mode selected by the parsed CLI flags.
 *
 * Non-TTY detection only decides whether headless mode should run at all.
 * Once headless mode is selected, `--json` is the only switch that chooses
 * NDJSON streaming versus the default text mode (stdout final answer plus
 * stderr activity snippets).
 *
 * @param state - Initialized application state for the run.
 * @param cli - Parsed CLI options.
 * @param tty - Current TTY availability.
 * @param deps - Injected I/O and runner callbacks.
 * @returns The terminal stop reason for the headless run.
 */
export async function runHeadlessCli(
  state: AppState,
  cli: CliOptions,
  tty: TtyState,
  deps: {
    readStdin: () => Promise<string>;
    runJson: (
      state: AppState,
      rawPrompt: string,
    ) => Promise<HeadlessCliStopReason>;
    runText: (
      state: AppState,
      rawPrompt: string,
    ) => Promise<HeadlessCliStopReason>;
  },
): Promise<HeadlessCliStopReason> {
  const rawPrompt = await resolveHeadlessPrompt(cli, tty, deps.readStdin);
  return cli.json
    ? deps.runJson(state, rawPrompt)
    : deps.runText(state, rawPrompt);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/**
 * Start the mini-coder CLI.
 *
 * Initializes application state and launches either the interactive TUI or
 * the headless one-shot runner based on CLI flags and TTY availability.
 *
 * @returns A promise that resolves once startup is complete.
 */
export async function main(): Promise<void> {
  const cli = parseCliArgs(process.argv.slice(2));
  const tty = {
    stdinIsTTY: process.stdin.isTTY ?? false,
    stdoutIsTTY: process.stdout.isTTY ?? false,
  };
  const state = await init();

  if (shouldUseHeadlessMode(cli, tty)) {
    try {
      const stopReason = await runHeadlessCli(state, cli, tty, {
        readStdin: async () => Bun.stdin.text(),
        runJson: async (headlessState, rawPrompt) => {
          const { runHeadlessPrompt } = await import("./headless.ts");
          return runHeadlessPrompt(headlessState, rawPrompt);
        },
        runText: async (headlessState, rawPrompt) => {
          const { runHeadlessPromptText } = await import("./headless.ts");
          return runHeadlessPromptText(headlessState, rawPrompt);
        },
      });
      if (stopReason === "aborted") {
        process.exitCode = 130;
      } else if (stopReason === "error") {
        process.exitCode = 1;
      }
      return;
    } finally {
      await shutdown(state);
    }
  }

  const { startUI } = await import("./ui.ts");
  startUI(state);
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
