import { afterEach, describe, expect, test } from "bun:test";
import { autoDiscoverModel, resolveModel } from "./providers.ts";

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
	test("rejects model strings without provider prefix", () => {
		expect(() => resolveModel("gpt-4o")).toThrow(
			'Invalid model string "gpt-4o". Expected format: "<provider>/<model-id>"',
		);
	});

	test("rejects unsupported providers", () => {
		expect(() => resolveModel("foo/bar")).toThrow(
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

		expect(autoDiscoverModel()).toBe("ollama/llama3.2");

		process.env.GEMINI_API_KEY = "gem";
		expect(autoDiscoverModel()).toBe("google/gemini-2.0-flash");

		process.env.OPENAI_API_KEY = "openai";
		expect(autoDiscoverModel()).toBe("openai/gpt-4o");

		process.env.ANTHROPIC_API_KEY = "anthropic";
		expect(autoDiscoverModel()).toBe("anthropic/claude-sonnet-4-5-20250929");

		process.env.OPENCODE_API_KEY = "zen";
		expect(autoDiscoverModel()).toBe("zen/claude-sonnet-4-6");
	});
});
