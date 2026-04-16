import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type AgentContext,
  destroyPlugins,
  initPlugins,
  loadPluginConfig,
  type PluginEntry,
} from "./plugins.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "mc-plugins-"));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function makeContext(): AgentContext {
  return {
    cwd: tmp,
    messages: [],
    dataDir: join(tmp, ".config"),
  };
}

/** Write a plugin module file and return its path. */
function writePlugin(name: string, code: string): string {
  const path = join(tmp, `${name}.ts`);
  writeFileSync(path, code);
  return path;
}

// ---------------------------------------------------------------------------
// loadPluginConfig
// ---------------------------------------------------------------------------

describe("loadPluginConfig", () => {
  test("parses plugin entries from config file", () => {
    const config = {
      plugins: [
        { name: "test", module: "./test-plugin.ts" },
        { name: "other", module: "@scope/plugin", config: { key: "value" } },
      ],
    };
    writeFileSync(join(tmp, "plugins.json"), JSON.stringify(config));

    const entries = loadPluginConfig(join(tmp, "plugins.json"));
    expect(entries).toHaveLength(2);
    expect(entries[0]!.name).toBe("test");
    expect(entries[1]!.config).toEqual({ key: "value" });
  });
});

// ---------------------------------------------------------------------------
// initPlugins
// ---------------------------------------------------------------------------

describe("initPlugins", () => {
  test("loads and initializes a plugin module", async () => {
    const modulePath = writePlugin(
      "good-plugin",
      `
      export const name = "good";
      export const description = "A good plugin";
      export async function init(agent, config) {
        return { systemPromptSuffix: "Plugin context: good" };
      }
      `,
    );

    const entries: PluginEntry[] = [{ name: "good", module: modulePath }];

    const loaded = await initPlugins(entries, makeContext());
    expect(loaded).toHaveLength(1);
    expect(loaded[0]!.result.systemPromptSuffix).toContain("good");
  });

  test("passes config to plugin init", async () => {
    const modulePath = writePlugin(
      "config-plugin",
      `
      export const name = "configurable";
      export const description = "Reads config";
      export async function init(agent, config) {
        return { systemPromptSuffix: "key=" + config?.key };
      }
      `,
    );

    const entries: PluginEntry[] = [
      { name: "configurable", module: modulePath, config: { key: "hello" } },
    ];

    const loaded = await initPlugins(entries, makeContext());
    expect(loaded[0]!.result.systemPromptSuffix).toContain("hello");
  });

  test("skips plugins that fail to load and reports error", async () => {
    const entries: PluginEntry[] = [
      { name: "missing", module: join(tmp, "does-not-exist.ts") },
    ];

    const errors: Array<{ name: string; error: Error }> = [];
    const loaded = await initPlugins(entries, makeContext(), (entry, error) => {
      errors.push({ name: entry.name, error });
    });

    expect(loaded).toHaveLength(0);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.name).toBe("missing");
  });

  test("skips plugins that fail during init and reports error", async () => {
    const modulePath = writePlugin(
      "bad-init",
      `
      export const name = "bad";
      export const description = "Fails on init";
      export async function init() {
        throw new Error("init exploded");
      }
      `,
    );

    const entries: PluginEntry[] = [{ name: "bad", module: modulePath }];

    const errors: Array<{ name: string; message: string }> = [];
    const loaded = await initPlugins(entries, makeContext(), (entry, error) => {
      errors.push({ name: entry.name, message: error.message });
    });

    expect(loaded).toHaveLength(0);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.message).toContain("init exploded");
  });

  test("collects tools from plugin results", async () => {
    const modulePath = writePlugin(
      "tool-plugin",
      `
      export const name = "tools";
      export const description = "Provides tools";
      export async function init() {
        return {
          tools: [{
            name: "custom_tool",
            description: "A custom tool",
            parameters: { type: "object", properties: {} },
          }],
        };
      }
      `,
    );

    const entries: PluginEntry[] = [{ name: "tools", module: modulePath }];

    const loaded = await initPlugins(entries, makeContext());
    expect(loaded[0]!.result.tools).toHaveLength(1);
    expect(loaded[0]!.result.tools![0]!.name).toBe("custom_tool");
  });
});

// ---------------------------------------------------------------------------
// destroyPlugins
// ---------------------------------------------------------------------------

describe("destroyPlugins", () => {
  test("calls destroy on plugins that implement it", async () => {
    // Use a file as a side-effect marker
    const markerPath = join(tmp, "destroyed.txt");
    const modulePath = writePlugin(
      "destroyable",
      `
      import { writeFileSync } from "node:fs";
      export const name = "destroyable";
      export const description = "Has destroy";
      export async function init() { return {}; }
      export async function destroy() {
        writeFileSync("${markerPath}", "destroyed");
      }
      `,
    );

    const entries: PluginEntry[] = [
      { name: "destroyable", module: modulePath },
    ];

    const loaded = await initPlugins(entries, makeContext());
    await destroyPlugins(loaded);

    const { existsSync } = await import("node:fs");
    expect(existsSync(markerPath)).toBe(true);
  });

  test("reports destroy errors without stopping other plugins", async () => {
    const marker1 = join(tmp, "d1.txt");
    const mod1 = writePlugin(
      "p1",
      `
      export const name = "p1";
      export const description = "Fails destroy";
      export async function init() { return {}; }
      export async function destroy() { throw new Error("destroy failed"); }
      `,
    );
    const mod2 = writePlugin(
      "p2",
      `
      import { writeFileSync } from "node:fs";
      export const name = "p2";
      export const description = "Good destroy";
      export async function init() { return {}; }
      export async function destroy() { writeFileSync("${marker1}", "ok"); }
      `,
    );

    const entries: PluginEntry[] = [
      { name: "p1", module: mod1 },
      { name: "p2", module: mod2 },
    ];

    const loaded = await initPlugins(entries, makeContext());

    const errors: string[] = [];
    await destroyPlugins(loaded, (entry, error) => {
      errors.push(`${entry.name}: ${error.message}`);
    });

    // p1 failed but p2 still ran
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("p1");
    const { existsSync } = await import("node:fs");
    expect(existsSync(marker1)).toBe(true);
  });
});
