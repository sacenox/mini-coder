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
  test("loadSettings returns empty object when the file does not exist", () => {
    const dir = createTempDir();
    const path = join(dir, "settings.json");

    expect(loadSettings(path)).toEqual({});
  });

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

    expect(() => loadSettings(path)).toThrow(
      `Failed to read settings ${path}:`,
    );
  });

  test("updateSettings preserves an invalid settings file instead of overwriting it", () => {
    const dir = createTempDir();
    const path = join(dir, "settings.json");
    const invalidJson = "{not json";
    writeFileSync(path, invalidJson, "utf-8");

    expect(() => updateSettings(path, { verbose: true })).toThrow(
      `Failed to read settings ${path}:`,
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
});
