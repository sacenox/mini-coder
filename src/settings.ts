/**
 * User settings persistence and startup resolution.
 *
 * Stores global defaults such as model, effort, reasoning visibility,
 * verbose tool output, custom providers, and MCP server settings in a JSON
 * file under the app data directory.
 *
 * @module
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { ThinkingLevel } from "@mariozechner/pi-ai";
import { getErrorMessage } from "./errors.ts";
import { readBoolean, readString, toRecord } from "./shared.ts";

/** A user-configured OpenAI-compatible provider endpoint. */
export interface CustomProvider {
  /** Provider identifier, e.g. "ollama". Shown as the provider prefix in model names. */
  name: string;
  /** OpenAI-compatible API base URL, e.g. "http://localhost:11434/v1". */
  baseUrl: string;
  /** Optional API key. Defaults to "no-key" at discovery time. */
  apiKey?: string;
}

/** A single configured MCP server endpoint. */
export interface McpServerConfig {
  /** Stable server identifier. Used as the imported tool-name prefix. */
  name: string;
  /** Absolute Streamable HTTP MCP endpoint URL. */
  url: string;
  /** Whether the server should start enabled. */
  enabled: boolean;
}

/** MCP-related user settings. */
export interface McpSettings {
  /** MCP servers to connect to at startup. */
  servers?: McpServerConfig[];
}

/** Default reasoning effort when no saved setting exists. */
const DEFAULT_EFFORT: ThinkingLevel = "medium";

/** Default reasoning visibility when no saved setting exists. */
export const DEFAULT_SHOW_REASONING = true;

/** Default verbose tool rendering flag when no saved setting exists. */
export const DEFAULT_VERBOSE = false;

/** Persisted global user settings. */
export interface UserSettings {
  /** Preferred provider/model identifier. */
  defaultModel?: string;
  /** Preferred reasoning effort. */
  defaultEffort?: ThinkingLevel;
  /** Whether reasoning blocks are shown in the UI. */
  showReasoning?: boolean;
  /** Whether full tool output is shown in the UI. */
  verbose?: boolean;
  /** Custom OpenAI-compatible provider endpoints. */
  customProviders?: CustomProvider[];
  /** MCP server definitions to manage and connect when enabled. */
  mcp?: McpSettings;
}

/** Resolved startup settings after applying defaults and availability checks. */
interface StartupSettings {
  /** Model to use for this launch, or `null` if none are available. */
  modelId: string | null;
  /** Effective reasoning effort. */
  effort: ThinkingLevel;
  /** Effective reasoning visibility. */
  showReasoning: boolean;
  /** Effective verbose flag. */
  verbose: boolean;
}

const THINKING_LEVELS = new Set<ThinkingLevel>([
  "low",
  "medium",
  "high",
  "xhigh",
]);

const MCP_SERVER_NAME_PATTERN = /^[A-Za-z0-9_-]+$/;

/**
 * Load and validate user settings from disk.
 *
 * Missing files are treated as empty settings. Invalid JSON or unreadable files
 * fail with a descriptive error instead of silently discarding saved state.
 *
 * @param path - Absolute path to `settings.json`.
 * @returns The validated settings object.
 */
export function loadSettings(path: string): UserSettings {
  if (!existsSync(path)) {
    return {};
  }

  try {
    return parseSettingsFile(path);
  } catch (error) {
    throw createSettingsReadError(path, error);
  }
}

/**
 * Load settings for startup without aborting on invalid JSON.
 *
 * Missing files and invalid JSON content are treated as empty settings so
 * startup behaves like there are no saved settings. Other filesystem errors
 * still fail with the same descriptive read error as {@link loadSettings}.
 *
 * @param path - Absolute path to `settings.json`.
 * @returns The validated settings object, or `{}` when startup should ignore invalid JSON.
 */
export function loadStartupSettings(path: string): UserSettings {
  if (!existsSync(path)) {
    return {};
  }

  try {
    return parseSettingsFile(path);
  } catch (error) {
    if (error instanceof SyntaxError) {
      return {};
    }
    throw createSettingsReadError(path, error);
  }
}

/**
 * Merge two settings objects using startup overlay semantics.
 *
 * Scalar fields use override-wins. `customProviders` merges by provider name,
 * and `mcp.servers` merges by server name. Same-name override entries replace
 * base entries while keeping the base ordering stable; new override entries are
 * appended in override order.
 *
 * @param base - Base settings, usually the global settings file.
 * @param override - Higher-priority settings, usually a repo-local overlay.
 * @returns The merged effective settings.
 */
export function mergeUserSettings(
  base: UserSettings,
  override: UserSettings,
): UserSettings {
  const sanitizedBase = sanitizeSettings(base);
  const sanitizedOverride = sanitizeSettings(override);
  const merged: UserSettings = {
    ...sanitizedBase,
    ...sanitizedOverride,
  };

  const customProviders = mergeNamedEntries(
    sanitizedBase.customProviders,
    sanitizedOverride.customProviders,
  );
  if (customProviders) {
    merged.customProviders = customProviders;
  } else {
    delete merged.customProviders;
  }

  const servers = mergeNamedEntries(
    sanitizedBase.mcp?.servers,
    sanitizedOverride.mcp?.servers,
  );
  if (servers) {
    merged.mcp = { servers };
  } else {
    delete merged.mcp;
  }

  return merged;
}

/**
 * Save user settings to disk.
 *
 * Parent directories are created automatically. Only validated fields are
 * written to disk.
 *
 * @param path - Absolute path to `settings.json`.
 * @param settings - Settings to persist.
 * @returns The validated settings that were written.
 */
export function saveSettings(
  path: string,
  settings: UserSettings,
): UserSettings {
  const sanitized = sanitizeSettings(settings);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(sanitized, null, 2), "utf-8");
  return sanitized;
}

/**
 * Merge a partial settings update with the current file contents and persist it.
 *
 * Invalid fields in the update are ignored.
 *
 * @param path - Absolute path to `settings.json`.
 * @param update - Partial settings update to merge.
 * @returns The merged settings after persistence.
 */
export function updateSettings(
  path: string,
  update: Partial<UserSettings>,
): UserSettings {
  const current = loadSettings(path);
  const merged = mergeUserSettings(current, sanitizeSettings(update));
  return saveSettings(path, merged);
}

/**
 * Resolve the effective startup settings for the current launch.
 *
 * The saved preferred model is only used when it is currently available.
 * Otherwise the first available model is used for this launch, while the saved
 * preference remains unchanged on disk.
 *
 * @param settings - Saved user settings.
 * @param availableModelIds - Provider/model identifiers available this launch.
 * @returns Effective startup settings with fallbacks applied.
 */
export function resolveStartupSettings(
  settings: UserSettings,
  availableModelIds: readonly string[],
): StartupSettings {
  const preferredModel = settings.defaultModel;
  const modelId =
    preferredModel && availableModelIds.includes(preferredModel)
      ? preferredModel
      : (availableModelIds[0] ?? null);

  return {
    modelId,
    effort: settings.defaultEffort ?? DEFAULT_EFFORT,
    showReasoning: settings.showReasoning ?? DEFAULT_SHOW_REASONING,
    verbose: settings.verbose ?? DEFAULT_VERBOSE,
  };
}

function mergeNamedEntries<T extends { name: string }>(
  base: readonly T[] | undefined,
  override: readonly T[] | undefined,
): T[] | undefined {
  if (!base?.length && !override?.length) {
    return undefined;
  }

  const merged = [...(base ?? [])];
  const indexes = new Map<string, number>();

  for (const [index, entry] of merged.entries()) {
    indexes.set(entry.name, index);
  }

  for (const entry of override ?? []) {
    const existingIndex = indexes.get(entry.name);
    if (existingIndex === undefined) {
      indexes.set(entry.name, merged.length);
      merged.push(entry);
      continue;
    }

    merged[existingIndex] = entry;
  }

  return merged.length > 0 ? merged : undefined;
}

function parseSettingsFile(path: string): UserSettings {
  const raw = JSON.parse(readFileSync(path, "utf-8")) as unknown;
  return sanitizeSettings(raw);
}

function createSettingsReadError(path: string, error: unknown): Error {
  return new Error(
    `Failed to read settings ${path}: ${getErrorMessage(error)}`,
  );
}

/**
 * Validate and normalize a parsed settings object.
 *
 * Unknown or invalid fields are dropped.
 *
 * @param value - Parsed JSON value.
 * @returns Sanitized settings.
 */
function sanitizeSettings(value: unknown): UserSettings {
  const candidate = toRecord(value);
  if (!candidate) {
    return {};
  }

  const settings: UserSettings = {};
  const defaultModel = readString(candidate, "defaultModel");
  const showReasoning = readBoolean(candidate, "showReasoning");
  const verbose = readBoolean(candidate, "verbose");

  if (defaultModel !== null) {
    settings.defaultModel = defaultModel;
  }
  if (isThinkingLevel(candidate.defaultEffort)) {
    settings.defaultEffort = candidate.defaultEffort;
  }
  if (showReasoning !== null) {
    settings.showReasoning = showReasoning;
  }
  if (verbose !== null) {
    settings.verbose = verbose;
  }

  const customProviders = sanitizeCustomProviders(candidate.customProviders);
  if (customProviders) {
    settings.customProviders = customProviders;
  }

  const mcp = sanitizeMcpSettings(candidate.mcp);
  if (mcp) {
    settings.mcp = mcp;
  }

  return settings;
}

/** Try to parse a single custom provider entry, returning null on failure. */
function parseCustomProvider(item: unknown): CustomProvider | null {
  const candidate = toRecord(item);
  if (!candidate) {
    return null;
  }

  const name = readString(candidate, "name")?.trim() ?? "";
  const baseUrl = readString(candidate, "baseUrl")?.trim() ?? "";

  if (!name || !baseUrl) {
    return null;
  }

  const entry: CustomProvider = { name, baseUrl };
  const apiKey = readString(candidate, "apiKey");
  if (apiKey !== null) {
    entry.apiKey = apiKey;
  }
  return entry;
}

/**
 * Validate and normalize custom provider entries.
 *
 * Drops entries with missing/empty name or baseUrl, and deduplicates by name
 * (first entry wins).
 */
function sanitizeCustomProviders(value: unknown): CustomProvider[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const result: CustomProvider[] = [];
  const seen = new Set<string>();

  for (const item of value) {
    const entry = parseCustomProvider(item);
    if (!entry || seen.has(entry.name)) {
      continue;
    }
    seen.add(entry.name);
    result.push(entry);
  }

  return result.length > 0 ? result : undefined;
}

function sanitizeMcpSettings(value: unknown): McpSettings | undefined {
  const candidate = toRecord(value);
  if (!candidate) {
    return undefined;
  }

  const servers = sanitizeMcpServers(candidate.servers);
  if (!servers) {
    return undefined;
  }

  return { servers };
}

/** Try to parse a single MCP server entry, returning null on failure. */
function parseMcpServer(item: unknown): McpServerConfig | null {
  const candidate = toRecord(item);
  if (!candidate) {
    return null;
  }

  const name = readString(candidate, "name")?.trim() ?? "";
  const url = readString(candidate, "url")?.trim() ?? "";
  const enabled = readBoolean(candidate, "enabled") ?? true;

  if (!name || !url || !MCP_SERVER_NAME_PATTERN.test(name)) {
    return null;
  }

  return { name, url, enabled };
}

/**
 * Validate and normalize configured MCP servers.
 *
 * Drops entries with missing/invalid names or URLs, and deduplicates by name
 * (first entry wins).
 */
function sanitizeMcpServers(value: unknown): McpServerConfig[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const result: McpServerConfig[] = [];
  const seen = new Set<string>();

  for (const item of value) {
    const entry = parseMcpServer(item);
    if (!entry || seen.has(entry.name)) {
      continue;
    }
    seen.add(entry.name);
    result.push(entry);
  }

  return result.length > 0 ? result : undefined;
}

/**
 * Check whether a value is a valid thinking level.
 *
 * @param value - Value to validate.
 * @returns `true` when the value is a supported thinking level.
 */
function isThinkingLevel(value: unknown): value is ThinkingLevel {
  return (
    typeof value === "string" && THINKING_LEVELS.has(value as ThinkingLevel)
  );
}
