import { afterEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadSettings,
  loadStartupSettings,
  resolveStartupSettings,
  saveSettings,
  type UserSettings,
  updateSettings,
} from "./settings.ts";

const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "mini-coder-settings-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("settings", () => {
  test("loadSettings parses valid settings", () => {
    const dir = createTempDir();
    const path = join(dir, "settings.json");
    const settings: UserSettings = {
      defaultModel: "anthropic/claude-sonnet-4",
      defaultEffort: "high",
      showReasoning: false,
      verbose: true,
    };
    writeFileSync(path, JSON.stringify(settings), "utf-8");

    expect(loadSettings(path)).toEqual(settings);
  });

  test("loadSettings throws a helpful error when the file contains invalid JSON", () => {
    const dir = createTempDir();
    const path = join(dir, "settings.json");
    writeFileSync(path, "{not json", "utf-8");

    expect(() => loadSettings(path)).toThrow(/Failed to read settings .*:/);
  });

  test("loadStartupSettings treats invalid JSON as no saved settings", () => {
    const dir = createTempDir();
    const path = join(dir, "settings.json");
    writeFileSync(path, "{not json", "utf-8");

    expect(loadStartupSettings(path)).toEqual({});
  });

  test("updateSettings preserves an invalid settings file instead of overwriting it", () => {
    const dir = createTempDir();
    const path = join(dir, "settings.json");
    const invalidJson = "{not json";
    writeFileSync(path, invalidJson, "utf-8");

    expect(() => updateSettings(path, { verbose: true })).toThrow(
      /Failed to read settings .*:/,
    );
    expect(readFileSync(path, "utf-8")).toBe(invalidJson);
  });

  test("loadSettings keeps valid fields and drops invalid ones", () => {
    const dir = createTempDir();
    const path = join(dir, "settings.json");
    writeFileSync(
      path,
      JSON.stringify({
        defaultModel: "openai/gpt-5",
        defaultEffort: "turbo",
        showReasoning: "yes",
        verbose: false,
      }),
      "utf-8",
    );

    expect(loadSettings(path)).toEqual({
      defaultModel: "openai/gpt-5",
      verbose: false,
    });
  });

  test("saveSettings creates parent directories and writes the file", () => {
    const dir = createTempDir();
    const path = join(dir, "nested", "settings.json");
    const settings: UserSettings = {
      defaultModel: "anthropic/claude-sonnet-4",
      defaultEffort: "medium",
      showReasoning: true,
      verbose: false,
    };

    saveSettings(path, settings);

    expect(existsSync(path)).toBe(true);
    expect(JSON.parse(readFileSync(path, "utf-8"))).toEqual(settings);
  });

  test("updateSettings merges a partial update with existing settings", () => {
    const dir = createTempDir();
    const path = join(dir, "settings.json");
    writeFileSync(
      path,
      JSON.stringify({
        defaultModel: "anthropic/claude-sonnet-4",
        defaultEffort: "medium",
        showReasoning: true,
        verbose: false,
      }),
      "utf-8",
    );

    const updated = updateSettings(path, {
      defaultEffort: "xhigh",
      verbose: true,
    });

    expect(updated).toEqual({
      defaultModel: "anthropic/claude-sonnet-4",
      defaultEffort: "xhigh",
      showReasoning: true,
      verbose: true,
    });
    expect(loadSettings(path)).toEqual(updated);
  });

  test("resolveStartupSettings uses saved defaults when available", () => {
    const resolved = resolveStartupSettings(
      {
        defaultModel: "anthropic/claude-sonnet-4",
        defaultEffort: "high",
        showReasoning: false,
        verbose: true,
      },
      ["anthropic/claude-sonnet-4", "openai/gpt-5"],
    );

    expect(resolved).toEqual({
      modelId: "anthropic/claude-sonnet-4",
      effort: "high",
      showReasoning: false,
      verbose: true,
    });
  });

  test("resolveStartupSettings falls back to the first available model when the saved model is unavailable", () => {
    const resolved = resolveStartupSettings(
      {
        defaultModel: "openai/gpt-5",
      },
      ["anthropic/claude-sonnet-4", "google/gemini-2.5-pro"],
    );

    expect(resolved).toEqual({
      modelId: "anthropic/claude-sonnet-4",
      effort: "medium",
      showReasoning: true,
      verbose: false,
    });
  });

  test("resolveStartupSettings falls back to defaults when saved values are missing", () => {
    const resolved = resolveStartupSettings({}, ["anthropic/claude-sonnet-4"]);

    expect(resolved).toEqual({
      modelId: "anthropic/claude-sonnet-4",
      effort: "medium",
      showReasoning: true,
      verbose: false,
    });
  });

  test("resolveStartupSettings returns a null model when no models are available", () => {
    const resolved = resolveStartupSettings(
      {
        defaultModel: "anthropic/claude-sonnet-4",
        defaultEffort: "low",
        showReasoning: true,
        verbose: false,
      },
      [],
    );

    expect(resolved).toEqual({
      modelId: null,
      effort: "low",
      showReasoning: true,
      verbose: false,
    });
  });

  test("loadSettings parses valid customProviders entries", () => {
    const dir = createTempDir();
    const path = join(dir, "settings.json");
    writeFileSync(
      path,
      JSON.stringify({
        customProviders: [
          { name: "ollama", baseUrl: "http://localhost:11434/v1" },
          {
            name: "lm-studio",
            baseUrl: "http://localhost:1234/v1",
            apiKey: "lm-studio",
          },
        ],
      }),
      "utf-8",
    );

    const settings = loadSettings(path);
    expect(settings.customProviders).toEqual([
      { name: "ollama", baseUrl: "http://localhost:11434/v1" },
      {
        name: "lm-studio",
        baseUrl: "http://localhost:1234/v1",
        apiKey: "lm-studio",
      },
    ]);
  });

  test("loadSettings drops customProviders entries with missing or invalid fields", () => {
    const dir = createTempDir();
    const path = join(dir, "settings.json");
    writeFileSync(
      path,
      JSON.stringify({
        customProviders: [
          { name: "good", baseUrl: "http://localhost:11434/v1" },
          { name: "", baseUrl: "http://localhost:1234/v1" },
          { name: "no-url" },
          { baseUrl: "http://localhost:5678/v1" },
          "not-an-object",
          42,
          null,
        ],
      }),
      "utf-8",
    );

    const settings = loadSettings(path);
    expect(settings.customProviders).toEqual([
      { name: "good", baseUrl: "http://localhost:11434/v1" },
    ]);
  });

  test("loadSettings drops duplicate customProviders names keeping the first", () => {
    const dir = createTempDir();
    const path = join(dir, "settings.json");
    writeFileSync(
      path,
      JSON.stringify({
        customProviders: [
          { name: "ollama", baseUrl: "http://localhost:11434/v1" },
          { name: "ollama", baseUrl: "http://localhost:9999/v1" },
        ],
      }),
      "utf-8",
    );

    const settings = loadSettings(path);
    expect(settings.customProviders).toEqual([
      { name: "ollama", baseUrl: "http://localhost:11434/v1" },
    ]);
  });

  test("loadSettings omits customProviders when the field is not an array", () => {
    const dir = createTempDir();
    const path = join(dir, "settings.json");
    writeFileSync(
      path,
      JSON.stringify({ customProviders: "not-an-array" }),
      "utf-8",
    );

    const settings = loadSettings(path);
    expect(settings.customProviders).toBeUndefined();
  });

  test("loadSettings parses valid MCP server entries", () => {
    const dir = createTempDir();
    const path = join(dir, "settings.json");
    writeFileSync(
      path,
      JSON.stringify({
        mcp: {
          servers: [
            { name: "docs", url: "http://127.0.0.1:8787/mcp" },
            { name: "github_tools", url: "https://example.com/mcp" },
          ],
        },
      }),
      "utf-8",
    );

    const settings = loadSettings(path);
    expect(settings.mcp).toEqual({
      servers: [
        { name: "docs", url: "http://127.0.0.1:8787/mcp" },
        { name: "github_tools", url: "https://example.com/mcp" },
      ],
    });
  });

  test("loadSettings drops MCP servers with invalid or duplicate names", () => {
    const dir = createTempDir();
    const path = join(dir, "settings.json");
    writeFileSync(
      path,
      JSON.stringify({
        mcp: {
          servers: [
            { name: "docs", url: "http://127.0.0.1:8787/mcp" },
            { name: "docs", url: "http://127.0.0.1:8788/mcp" },
            { name: "bad name", url: "http://127.0.0.1:8789/mcp" },
            { name: "", url: "http://127.0.0.1:8790/mcp" },
            { name: "missing-url" },
            42,
            null,
          ],
        },
      }),
      "utf-8",
    );

    const settings = loadSettings(path);
    expect(settings.mcp).toEqual({
      servers: [{ name: "docs", url: "http://127.0.0.1:8787/mcp" }],
    });
  });

  test("updateSettings preserves existing MCP settings when applying another field", () => {
    const dir = createTempDir();
    const path = join(dir, "settings.json");
    writeFileSync(
      path,
      JSON.stringify({
        verbose: false,
        mcp: {
          servers: [{ name: "docs", url: "http://127.0.0.1:8787/mcp" }],
        },
      }),
      "utf-8",
    );

    const updated = updateSettings(path, { verbose: true });

    expect(updated).toEqual({
      verbose: true,
      mcp: {
        servers: [{ name: "docs", url: "http://127.0.0.1:8787/mcp" }],
      },
    });
  });
});
