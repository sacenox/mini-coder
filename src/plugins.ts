/**
 * Plugin loader and lifecycle management.
 *
 * Plugins extend mini-coder with additional tools and system prompt context.
 * They are declared in a config file and loaded as modules at startup.
 * Each plugin's `init` is called once, and `destroy` (if present) is called
 * on shutdown.
 *
 * @module
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Message, Tool } from "@mariozechner/pi-ai";
import type { Theme } from "./theme.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Context provided to plugins during initialization.
 *
 * Gives plugins read-only access to the agent's environment without
 * exposing internal implementation details.
 */
export interface AgentContext {
  /** The working directory. */
  cwd: string;
  /** Read-only access to the current session's messages. */
  messages: readonly Message[];
  /** The app data directory (`~/.config/mini-coder/`). */
  dataDir: string;
}

/**
 * Result returned by a plugin's `init` function.
 *
 * Contains any additional tools the agent should register and/or
 * context to append to the system prompt.
 */
export interface PluginResult {
  /** Additional tools the agent can use. */
  tools?: Tool[];
  /** Additional context to append to the system prompt. */
  systemPromptSuffix?: string;
  /** Partial theme override — merged on top of the default theme. */
  theme?: Partial<Theme>;
}

/**
 * The interface a plugin module must implement.
 *
 * A plugin is a module that exports a conforming object. It is loaded
 * dynamically from a path or package name declared in the config file.
 */
export interface Plugin {
  /** Human-readable plugin name. */
  name: string;
  /** Brief description of what the plugin provides. */
  description: string;
  /** Called once at startup. Returns tools to register and/or context to add. */
  init(
    agent: AgentContext,
    config?: Record<string, unknown>,
  ): Promise<PluginResult>;
  /** Called on shutdown for cleanup. */
  destroy?(): Promise<void>;
}

/** A single entry in the plugins config file. */
export interface PluginEntry {
  /** Plugin name (for display and error messages). */
  name: string;
  /** Module path or package name to import. */
  module: string;
  /** Optional configuration passed to the plugin's `init`. */
  config?: Record<string, unknown>;
}

/** A loaded and initialized plugin with its result. */
export interface LoadedPlugin {
  /** The plugin entry from config. */
  entry: PluginEntry;
  /** The plugin module instance. */
  plugin: Plugin;
  /** The result from calling `init`. */
  result: PluginResult;
}

// ---------------------------------------------------------------------------
// Config loading
// ---------------------------------------------------------------------------

/**
 * Load plugin entries from the config file.
 *
 * Reads and parses the plugins config file. Returns an empty array if
 * the file does not exist or contains no plugins.
 *
 * @param configPath - Path to the plugins config file (e.g. `~/.config/mini-coder/plugins.json`).
 * @returns Array of {@link PluginEntry} records.
 */
export function loadPluginConfig(configPath: string): PluginEntry[] {
  if (!existsSync(configPath)) return [];

  const raw = readFileSync(configPath, "utf-8");
  const parsed = JSON.parse(raw) as { plugins?: PluginEntry[] };
  return parsed.plugins ?? [];
}

// ---------------------------------------------------------------------------
// Plugin lifecycle
// ---------------------------------------------------------------------------

/**
 * Load and initialize all plugins from config entries.
 *
 * Imports each plugin module, calls its `init` with the agent context,
 * and collects the results. Plugins that fail to load or initialize are
 * skipped with a warning (logged via `onError`).
 *
 * @param entries - Plugin entries from the config file.
 * @param context - The agent context to pass to each plugin.
 * @param onError - Callback for plugin load/init errors.
 * @returns Array of successfully loaded plugins.
 */
export async function initPlugins(
  entries: PluginEntry[],
  context: AgentContext,
  onError?: (entry: PluginEntry, error: Error) => void,
): Promise<LoadedPlugin[]> {
  const loaded: LoadedPlugin[] = [];

  for (const entry of entries) {
    try {
      const modulePath = resolve(entry.module);
      const mod = (await import(modulePath)) as { default?: Plugin } & Plugin;
      const plugin = mod.default ?? mod;

      if (typeof plugin.init !== "function") {
        throw new Error(
          `Plugin "${entry.name}" does not export an init function`,
        );
      }

      const result = await plugin.init(context, entry.config);
      loaded.push({ entry, plugin, result });
    } catch (err) {
      onError?.(entry, err instanceof Error ? err : new Error(String(err)));
    }
  }

  return loaded;
}

/**
 * Destroy all loaded plugins.
 *
 * Calls `destroy` on each plugin that implements it. Errors during
 * destruction are passed to `onError` — destruction continues for
 * remaining plugins regardless.
 *
 * @param plugins - The loaded plugins to destroy.
 * @param onError - Callback for destruction errors.
 */
export async function destroyPlugins(
  plugins: LoadedPlugin[],
  onError?: (entry: PluginEntry, error: Error) => void,
): Promise<void> {
  for (const { entry, plugin } of plugins) {
    if (typeof plugin.destroy === "function") {
      try {
        await plugin.destroy();
      } catch (err) {
        onError?.(entry, err instanceof Error ? err : new Error(String(err)));
      }
    }
  }
}
