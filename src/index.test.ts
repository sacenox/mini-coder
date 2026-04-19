import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { type Model, Type } from "@mariozechner/pi-ai";
import {
  type AppState,
  buildToolList,
  didOAuthCredentialsChange,
  discoverCustomProviders,
  getAvailableModels,
  loadOAuthCredentials,
  loadPromptContext,
  reloadPromptContext,
  runHeadlessCli,
} from "./index.ts";
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

function createTestState(): AppState {
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
    queuedUserMessages: [],
    showReasoning: true,
    verbose: false,
    versionLabel: "dev",
    mcpServers: [],
    customModels: [],
    startupWarnings: [],
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
  expect(result.stderr).toContain(
    "Headless mode does not support slash commands: /help",
  );
  expect(result.stderr.trim().split("\n")).toHaveLength(1);
});

test("init treats invalid settings.json as no saved settings", async () => {
  const home = createTempDir();
  const configDir = join(home, ".config", "mini-coder");
  mkdirSync(configDir, { recursive: true });
  writeFileSync(join(configDir, "settings.json"), "{not json", "utf-8");

  const result = await runChild(
    [
      process.execPath,
      "--eval",
      [
        `const { init } = await import(${JSON.stringify(INDEX_MODULE_URL)});`,
        "const state = await init();",
        "try {",
        "  process.stdout.write(JSON.stringify({",
        "    settings: state.settings,",
        "    effort: state.effort,",
        "    showReasoning: state.showReasoning,",
        "    verbose: state.verbose,",
        "    modelId: state.model ? state.model.provider + '/' + state.model.id : null,",
        "  }));",
        "} finally {",
        "  state.db.close();",
        "}",
      ].join("\n"),
    ],
    {
      HOME: home,
      PATH: process.env.PATH,
      SHELL: process.env.SHELL,
      TERM: process.env.TERM,
    },
  );

  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe("");
  expect(JSON.parse(result.stdout)).toEqual({
    settings: {},
    effort: "medium",
    showReasoning: true,
    verbose: false,
    modelId: null,
  });
});

test("runHeadlessCli uses final-text mode by default in non-TTY environments", async () => {
  const state = createTestState();
  const calls: string[] = [];

  const stopReason = await runHeadlessCli(
    state,
    { prompt: "fix the tests", json: false },
    { stdinIsTTY: false, stdoutIsTTY: false },
    {
      readStdin: async () => {
        throw new Error("stdin should not be read when a prompt was provided");
      },
      runJson: async () => {
        calls.push("json");
        return "stop";
      },
      runText: async (_state, rawPrompt) => {
        calls.push(`text:${rawPrompt}`);
        return "stop";
      },
    },
  );

  expect(stopReason).toBe("stop");
  expect(calls).toEqual(["text:fix the tests"]);
});

test("runHeadlessCli uses NDJSON mode only when --json was requested", async () => {
  const state = createTestState();
  const calls: string[] = [];

  const stopReason = await runHeadlessCli(
    state,
    { prompt: "fix the tests", json: true },
    { stdinIsTTY: false, stdoutIsTTY: false },
    {
      readStdin: async () => {
        throw new Error("stdin should not be read when a prompt was provided");
      },
      runJson: async (_state, rawPrompt) => {
        calls.push(`json:${rawPrompt}`);
        return "stop";
      },
      runText: async () => {
        calls.push("text");
        return "stop";
      },
    },
  );

  expect(stopReason).toBe("stop");
  expect(calls).toEqual(["json:fix the tests"]);
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
    /Failed to read OAuth credentials .*:/,
  );
});

test("loadPromptContext loads AGENTS.md, skills, and the default theme", async () => {
  const project = createTempDir();

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

  const context = await loadPromptContext({ cwd: project });

  expect(context.cwd).toBe(project);
  expect(context.agentsMd.at(-1)?.content).toBe("Project instructions");
  expect(context.skills.map((skill) => skill.name)).toContain("example-skill");
  expect(context.theme).toBe(DEFAULT_THEME);
});

test("reloadPromptContext keeps the current prompt context when replacement loading fails", async () => {
  const state = createTestState();
  state.agentsMd = [{ path: "/tmp/AGENTS.md", content: "current agents" }];
  state.skills = [
    {
      name: "existing-skill",
      description: "Already loaded.",
      path: "/tmp/existing/SKILL.md",
    },
  ];

  try {
    await expect(
      reloadPromptContext(state, {
        loadPromptContext: async () => {
          throw new Error("reload failed");
        },
      }),
    ).rejects.toThrow("reload failed");

    expect(state.agentsMd).toEqual([
      { path: "/tmp/AGENTS.md", content: "current agents" },
    ]);
    expect(state.skills.map((skill) => skill.name)).toEqual(["existing-skill"]);
    expect(state.theme).toBe(DEFAULT_THEME);
  } finally {
    state.db.close();
  }
});

test("reloadPromptContext replaces the current prompt context", async () => {
  const state = createTestState();

  try {
    await reloadPromptContext(state, {
      loadPromptContext: async () => ({
        cwd: state.cwd,
        canonicalCwd: state.canonicalCwd,
        git: null,
        agentsMd: [{ path: "/tmp/AGENTS.md", content: "next agents" }],
        skills: [
          {
            name: "next-skill",
            description: "Replacement skill.",
            path: "/tmp/next/SKILL.md",
          },
        ],
        theme: { ...DEFAULT_THEME, accentText: "color05" },
      }),
    });

    expect(state.agentsMd).toEqual([
      { path: "/tmp/AGENTS.md", content: "next agents" },
    ]);
    expect(state.skills.map((skill) => skill.name)).toEqual(["next-skill"]);
    expect(state.theme.accentText).toBe("color05");
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

// ---------------------------------------------------------------------------
// buildToolList
// ---------------------------------------------------------------------------

test("buildToolList uses validated built-in handlers and gates readImage by model input", () => {
  const state = createTestState();
  try {
    const model: Model<string> = {
      id: "test-model",
      name: "test-model",
      api: "openai-completions",
      provider: "test-provider",
      baseUrl: "http://localhost:1234/v1",
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 8192,
      maxTokens: 4096,
    };
    state.model = model;

    const textOnlyTools = buildToolList(state);

    expect(textOnlyTools.tools.map((tool) => tool.name)).toEqual([
      "shell",
      "read",
      "grep",
      "edit",
      "todoWrite",
      "todoRead",
    ]);
    expect(textOnlyTools.toolHandlers.has("readImage")).toBe(false);
    expect(() =>
      textOnlyTools.toolHandlers.get("todoWrite")!({}, state.cwd),
    ).toThrow(/Validation failed for tool "todoWrite"/);

    state.model = { ...model, input: ["text", "image"] };

    const visionTools = buildToolList(state);

    expect(visionTools.tools.map((tool) => tool.name)).toContain("readImage");
    expect(visionTools.toolHandlers.has("readImage")).toBe(true);
  } finally {
    state.db.close();
  }
});

test("buildToolList includes connected MCP tools alongside built-ins", async () => {
  const state = createTestState();
  try {
    state.model = {
      id: "test-model",
      name: "test-model",
      api: "openai-completions",
      provider: "test-provider",
      baseUrl: "http://localhost:1234/v1",
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 8192,
      maxTokens: 4096,
    };
    state.mcpServers = [
      {
        name: "docs",
        url: "http://docs.test/mcp",
        enabled: true,
        tools: [
          {
            name: "docs__search",
            description: "[MCP docs] Search the docs",
            parameters: Type.Object({
              query: Type.String(),
            }),
          },
        ],
        toolHandlers: new Map([
          [
            "docs__search",
            async (args) => ({
              content: [
                {
                  type: "text",
                  text: JSON.stringify(args),
                },
              ],
              isError: false,
            }),
          ],
        ]),
        close: async () => {},
      },
    ];

    const toolList = buildToolList(state);

    expect(toolList.tools.map((tool) => tool.name)).toContain("docs__search");
    const toolResult = await toolList.toolHandlers.get("docs__search")!(
      { query: "routing" },
      state.cwd,
    );
    expect(toolResult).toEqual({
      content: [{ type: "text", text: '{"query":"routing"}' }],
      isError: false,
    });
  } finally {
    state.db.close();
  }
});

test("buildToolList excludes disabled MCP servers", () => {
  const state = createTestState();
  try {
    state.model = {
      id: "test-model",
      name: "test-model",
      api: "openai-completions",
      provider: "test-provider",
      baseUrl: "http://localhost:1234/v1",
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 8192,
      maxTokens: 4096,
    };
    state.mcpServers = [
      {
        name: "docs",
        url: "http://docs.test/mcp",
        enabled: false,
        tools: [
          {
            name: "docs__search",
            description: "[MCP docs] Search the docs",
            parameters: Type.Object({
              query: Type.String(),
            }),
          },
        ],
        toolHandlers: new Map([
          [
            "docs__search",
            async () => ({
              content: [{ type: "text", text: "ignored" }],
              isError: false,
            }),
          ],
        ]),
        close: async () => {},
      },
    ];

    const toolList = buildToolList(state);

    expect(toolList.tools.map((tool) => tool.name)).not.toContain(
      "docs__search",
    );
    expect(toolList.toolHandlers.has("docs__search")).toBe(false);
  } finally {
    state.db.close();
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
