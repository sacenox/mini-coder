import { afterEach, describe, expect, test } from "bun:test";
import { isLoggedIn } from "../session/oauth/auth-storage.ts";
import { autoDiscoverModel, resolveModel } from "./providers.ts";

const anthropicOAuth = isLoggedIn("anthropic");

const ENV_KEYS = [
  "OPENCODE_API_KEY",
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "GOOGLE_API_KEY",
  "GEMINI_API_KEY",
] as const;

const initialEnv = new Map<string, string | undefined>(
  ENV_KEYS.map((key) => [key, process.env[key]]),
);

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = initialEnv.get(key);
    if (value === undefined) {
      delete process.env[key];
      continue;
    }
    process.env[key] = value;
  }
});

describe("resolveModel", () => {
  test("rejects model strings without provider prefix", async () => {
    await expect(resolveModel("gpt-4o")).rejects.toThrow(
      'Invalid model string "gpt-4o". Expected format: "<provider>/<model-id>"',
    );
  });

  test("rejects unsupported providers", async () => {
    await expect(resolveModel("foo/bar")).rejects.toThrow(
      'Unknown provider "foo". Supported: zen, anthropic, openai, google, ollama',
    );
  });
});

describe("autoDiscoverModel", () => {
  test("uses provider priority order", () => {
    delete process.env.OPENCODE_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.GOOGLE_API_KEY;
    delete process.env.GEMINI_API_KEY;

    // With OAuth login, anthropic is discovered even without env key
    expect(autoDiscoverModel()).toBe(
      anthropicOAuth ? "anthropic/claude-sonnet-4-6" : "ollama/llama3.2",
    );

    process.env.GEMINI_API_KEY = "gem";
    expect(autoDiscoverModel()).toBe(
      anthropicOAuth ? "anthropic/claude-sonnet-4-6" : "google/gemini-3.1-pro",
    );

    process.env.OPENAI_API_KEY = "openai";
    expect(autoDiscoverModel()).toBe(
      anthropicOAuth ? "anthropic/claude-sonnet-4-6" : "openai/gpt-5.4",
    );

    process.env.ANTHROPIC_API_KEY = "anthropic";
    expect(autoDiscoverModel()).toBe("anthropic/claude-sonnet-4-6");

    process.env.OPENCODE_API_KEY = "zen";
    expect(autoDiscoverModel()).toBe("zen/claude-sonnet-4-6");
  });
});
