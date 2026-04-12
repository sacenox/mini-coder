import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { Model } from "@mariozechner/pi-ai";
import {
  type AppState,
  didOAuthCredentialsChange,
  discoverCustomProviders,
  getAvailableModels,
  loadOAuthCredentials,
  loadPromptContext,
  reloadPromptContext,
} from "./index.ts";
import type { LoadedPlugin } from "./plugins.ts";
import { openDatabase } from "./session.ts";
import { DEFAULT_THEME } from "./theme.ts";

const REPO_ROOT = join(import.meta.dir, "..");
const INDEX_MODULE_URL = pathToFileURL(join(import.meta.dir, "index.ts")).href;
const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "mc-index-test-"));
  tempDirs.push(dir);
  return dir;
}

function createTestState(plugins: LoadedPlugin[] = []): AppState {
  const cwd = createTempDir();
  return {
    db: openDatabase(":memory:"),
    session: null,
    model: null,
    effort: "medium",
    messages: [],
    stats: { totalInput: 0, totalOutput: 0, totalCost: 0 },
    contextTokens: 0,
    agentsMd: [],
    skills: [],
    plugins,
    theme: DEFAULT_THEME,
    git: null,
    providers: new Map(),
    oauthCredentials: {},
    settings: {},
    settingsPath: join(cwd, "settings.json"),
    cwd,
    canonicalCwd: cwd,
    running: false,
    abortController: null,
    activeTurnPromise: null,
    showReasoning: true,
    verbose: false,
    versionLabel: "dev",
    customModels: [],
    startupWarnings: [],
  };
}

function createLoadedPlugin(name: string): LoadedPlugin {
  return {
    entry: { name, module: `${name}.ts` },
    plugin: {
      name,
      description: `${name} plugin`,
      async init() {
        return {};
      },
      async destroy() {},
    },
    result: {
      systemPromptSuffix: `${name} suffix`,
      theme: { accentText: "color03" },
    },
  };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

async function runChild(
  command: string[],
  env: Record<string, string | undefined> = process.env,
): Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
}> {
  const proc = Bun.spawn(command, {
    cwd: REPO_ROOT,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env,
  });

  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      proc.kill();
      reject(new Error("Timed out waiting for child process to exit"));
    }, 1_000);
  });

  let exitCode: number;
  try {
    exitCode = await Promise.race([proc.exited, timeout]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }

  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();

  return { exitCode, stdout, stderr };
}

async function importIndexInChild(): Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
}> {
  return runChild([
    process.execPath,
    "--eval",
    `await import(${JSON.stringify(INDEX_MODULE_URL)}); process.stdout.write("imported\\n");`,
  ]);
}

test("importing index.ts does not start the CLI", async () => {
  const result = await importIndexInChild();

  expect(result.exitCode).toBe(0);
  expect(result.stdout).toBe("imported\n");
  expect(result.stderr).toBe("");
});

test("bin/mc.ts reports headless command errors without a stack trace", async () => {
  const home = createTempDir();
  const result = await runChild(
    [process.execPath, "run", "bin/mc.ts", "--", "-p", "/help"],
    {
      HOME: home,
      PATH: process.env.PATH,
      SHELL: process.env.SHELL,
      TERM: process.env.TERM,
    },
  );

  expect(result.exitCode).toBe(1);
  expect(result.stdout).toBe("");
  expect(result.stderr).toBe(
    "Headless mode does not support slash commands: /help\n",
  );
});

test("didOAuthCredentialsChange compares refreshed credentials structurally", () => {
  const current = {
    refresh: "refresh-token",
    access: "access-token",
    expires: 123,
  };
  const refreshedWithSameValues = {
    access: "access-token",
    expires: 123,
    refresh: "refresh-token",
  };

  expect(didOAuthCredentialsChange(current, refreshedWithSameValues)).toBe(
    false,
  );
  expect(
    didOAuthCredentialsChange(current, {
      ...refreshedWithSameValues,
      access: "new-access-token",
    }),
  ).toBe(true);
});

test("loadOAuthCredentials throws a helpful error when the auth file contains invalid JSON", () => {
  const dir = createTempDir();
  const path = join(dir, "auth.json");
  writeFileSync(path, "{not json", "utf-8");

  expect(() => loadOAuthCredentials(path)).toThrow(
    `Failed to read OAuth credentials ${path}:`,
  );
});

test("loadPromptContext loads AGENTS.md, skills, plugins, and theme overrides", async () => {
  const project = createTempDir();
  const pluginPath = join(project, "plugin.ts");

  writeFileSync(join(project, "AGENTS.md"), "Project instructions");
  mkdirSync(join(project, ".agents", "skills", "example-skill"), {
    recursive: true,
  });
  writeFileSync(
    join(project, ".agents", "skills", "example-skill", "SKILL.md"),
    [
      "---",
      "name: example-skill",
      'description: "Example skill."',
      "---",
      "",
      "# Example Skill",
    ].join("\n"),
  );
  writeFileSync(
    pluginPath,
    [
      "export default {",
      '  name: "test-plugin",',
      '  description: "Adds prompt context.",',
      "  async init(agent) {",
      "    return {",
      `      systemPromptSuffix: \`Plugin cwd: \${agent.cwd}\` ,`,
      '      theme: { accentText: "color03" },',
      "    };",
      "  },",
      "};",
    ].join("\n"),
  );

  const context = await loadPromptContext([], {
    cwd: project,
    pluginEntries: [{ name: "test-plugin", module: pluginPath }],
  });

  expect(context.cwd).toBe(project);
  expect(context.agentsMd.at(-1)?.content).toBe("Project instructions");
  expect(context.skills.map((skill) => skill.name)).toContain("example-skill");
  expect(context.plugins).toHaveLength(1);
  expect(context.plugins[0]?.result.systemPromptSuffix).toBe(
    `Plugin cwd: ${project}`,
  );
  expect(context.theme.accentText).toBe("color03");
});

test("reloadPromptContext keeps the current plugin state when loading the replacement context fails", async () => {
  const plugin = createLoadedPlugin("existing");
  const state = createTestState([plugin]);
  let destroyed = false;

  try {
    await expect(
      reloadPromptContext(state, {
        loadPromptContext: async () => {
          throw new Error("reload failed");
        },
        destroyPlugins: async () => {
          destroyed = true;
        },
      }),
    ).rejects.toThrow("reload failed");

    expect(destroyed).toBe(false);
    expect(state.plugins).toEqual([plugin]);
    expect(state.theme).toBe(DEFAULT_THEME);
  } finally {
    state.db.close();
  }
});

test("reloadPromptContext swaps in the new context before destroying the old plugins", async () => {
  const previousPlugin = createLoadedPlugin("previous");
  const nextPlugin = createLoadedPlugin("next");
  const state = createTestState([previousPlugin]);
  let destroyedPlugins: LoadedPlugin[] = [];

  try {
    await reloadPromptContext(state, {
      loadPromptContext: async () => ({
        cwd: state.cwd,
        canonicalCwd: state.canonicalCwd,
        git: null,
        agentsMd: [{ path: "/tmp/AGENTS.md", content: "next agents" }],
        skills: [],
        plugins: [nextPlugin],
        theme: { ...DEFAULT_THEME, accentText: "color05" },
      }),
      destroyPlugins: async (plugins) => {
        destroyedPlugins = [...plugins];
        expect(state.plugins).toEqual([nextPlugin]);
        expect(state.theme.accentText).toBe("color05");
      },
    });

    expect(destroyedPlugins).toEqual([previousPlugin]);
    expect(state.plugins).toEqual([nextPlugin]);
    expect(state.agentsMd).toEqual([
      { path: "/tmp/AGENTS.md", content: "next agents" },
    ]);
  } finally {
    state.db.close();
  }
});

// ---------------------------------------------------------------------------
// discoverCustomProviders
// ---------------------------------------------------------------------------

test("discoverCustomProviders returns models from a mock endpoint", async () => {
  const server = Bun.serve({
    port: 0,
    fetch() {
      return Response.json({
        data: [
          { id: "gemma4:31b", object: "model" },
          { id: "qwen3:8b", object: "model" },
        ],
      });
    },
  });

  try {
    const result = await discoverCustomProviders(
      [{ name: "test-local", baseUrl: `http://localhost:${server.port}` }],
      new Set(),
    );

    expect(result.warnings).toEqual([]);
    expect(result.models).toHaveLength(2);
    expect(result.models[0]).toMatchObject({
      id: "gemma4:31b",
      name: "gemma4:31b",
      api: "openai-completions",
      provider: "test-local",
      baseUrl: `http://localhost:${server.port}`,
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 131072,
      maxTokens: 8192,
    });
    expect(result.providers.get("test-local")).toBe("no-key");
  } finally {
    server.stop(true);
  }
});

test("discoverCustomProviders uses configured apiKey", async () => {
  const server = Bun.serve({
    port: 0,
    fetch() {
      return Response.json({ data: [{ id: "model-1", object: "model" }] });
    },
  });

  try {
    const result = await discoverCustomProviders(
      [
        {
          name: "keyed",
          baseUrl: `http://localhost:${server.port}`,
          apiKey: "my-secret-key",
        },
      ],
      new Set(),
    );

    expect(result.providers.get("keyed")).toBe("my-secret-key");
  } finally {
    server.stop(true);
  }
});

test("discoverCustomProviders returns a warning when the endpoint is unreachable", async () => {
  const result = await discoverCustomProviders(
    [{ name: "dead", baseUrl: "http://localhost:1" }],
    new Set(),
  );

  expect(result.models).toEqual([]);
  expect(result.providers.size).toBe(0);
  expect(result.warnings).toHaveLength(1);
  expect(result.warnings[0]).toContain('Custom provider "dead"');
  expect(result.warnings[0]).toContain("http://localhost:1/models");
});

test("discoverCustomProviders skips providers that collide with built-in names", async () => {
  const result = await discoverCustomProviders(
    [{ name: "openai", baseUrl: "http://localhost:11434/v1" }],
    new Set(["openai"]),
  );

  expect(result.models).toEqual([]);
  expect(result.warnings).toHaveLength(1);
  expect(result.warnings[0]).toContain('"openai"');
  expect(result.warnings[0]).toContain("built-in");
});

test("discoverCustomProviders handles empty model list from endpoint", async () => {
  const server = Bun.serve({
    port: 0,
    fetch() {
      return Response.json({ data: [] });
    },
  });

  try {
    const result = await discoverCustomProviders(
      [{ name: "empty", baseUrl: `http://localhost:${server.port}` }],
      new Set(),
    );

    expect(result.models).toEqual([]);
    expect(result.providers.get("empty")).toBe("no-key");
    expect(result.warnings).toEqual([]);
  } finally {
    server.stop(true);
  }
});

// ---------------------------------------------------------------------------
// getAvailableModels with custom models
// ---------------------------------------------------------------------------

test("getAvailableModels includes custom models alongside built-in models", () => {
  const state = createTestState();
  try {
    const customModel: Model<"openai-completions"> = {
      id: "gemma4:31b",
      name: "gemma4:31b",
      api: "openai-completions",
      provider: "ollama",
      baseUrl: "http://localhost:11434/v1",
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 131072,
      maxTokens: 8192,
    };
    state.customModels = [customModel];

    const models = getAvailableModels(state);
    expect(models).toContainEqual(customModel);
  } finally {
    state.db.close();
  }
});
