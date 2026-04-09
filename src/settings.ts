/**
 * User settings persistence and startup resolution.
 *
 * Stores global defaults such as model, effort, reasoning visibility,
 * and verbose tool output in a JSON file under the app data directory.
 *
 * @module
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { ThinkingLevel } from "@mariozechner/pi-ai";

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

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

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
    const raw = JSON.parse(readFileSync(path, "utf-8")) as unknown;
    return sanitizeSettings(raw);
  } catch (error) {
    throw new Error(
      `Failed to read settings ${path}: ${getErrorMessage(error)}`,
    );
  }
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
  const merged = { ...current, ...sanitizeSettings(update) };
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

/**
 * Validate and normalize a parsed settings object.
 *
 * Unknown or invalid fields are dropped.
 *
 * @param value - Parsed JSON value.
 * @returns Sanitized settings.
 */
function sanitizeSettings(value: unknown): UserSettings {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const candidate = value as Record<string, unknown>;
  const settings: UserSettings = {};

  if (typeof candidate.defaultModel === "string") {
    settings.defaultModel = candidate.defaultModel;
  }
  if (isThinkingLevel(candidate.defaultEffort)) {
    settings.defaultEffort = candidate.defaultEffort;
  }
  if (typeof candidate.showReasoning === "boolean") {
    settings.showReasoning = candidate.showReasoning;
  }
  if (typeof candidate.verbose === "boolean") {
    settings.verbose = candidate.verbose;
  }

  return settings;
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
