import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";

import { logApiEvent } from "./api-log.ts";
import {
	type AvailableModelsSnapshot,
	fetchAvailableModelsSnapshot,
} from "./model-info.ts";
import { getZenBackend } from "./model-routing.ts";

export { getContextWindow } from "./model-info.ts";
export type { ThinkingEffort } from "./provider-options.ts";

const SUPPORTED_PROVIDERS = [
	"zen",
	"anthropic",
	"openai",
	"google",
	"ollama",
] as const;

type ProviderName = (typeof SUPPORTED_PROVIDERS)[number];

const ZEN_BASE = "https://opencode.ai/zen/v1";

type ProviderFetch = typeof fetch;
type AnthropicProvider = ReturnType<typeof createAnthropic>;
type OpenAIProvider = ReturnType<typeof createOpenAI>;
type GoogleProvider = ReturnType<typeof createGoogleGenerativeAI>;
type OpenAICompatProvider = ReturnType<typeof createOpenAICompatible>;

function createFetchWithLogging(): ProviderFetch {
	const customFetch = async (
		input: Parameters<ProviderFetch>[0],
		init?: Parameters<ProviderFetch>[1],
	): Promise<Response> => {
		if (init?.body) {
			try {
				const bodyStr = init.body.toString();
				const bodyJson = JSON.parse(bodyStr);
				logApiEvent("Provider Request", {
					url: input.toString(),
					method: init.method,
					headers: init.headers,
					body: bodyJson,
				});
			} catch {
				logApiEvent("Provider Request", {
					url: input.toString(),
					method: init.method,
					headers: init.headers,
					body: init.body,
				});
			}
		}
		return fetch(input, init);
	};
	return customFetch as ProviderFetch;
}

const fetchWithLogging = createFetchWithLogging();

function requireEnv(name: string): string {
	const value = process.env[name];
	if (!value) throw new Error(`${name} is not set`);
	return value;
}

function requireAnyEnv(names: string[]): string {
	for (const name of names) {
		const value = process.env[name];
		if (value) return value;
	}
	throw new Error(`${names.join(" or ")} is not set`);
}

function lazy<T>(factory: () => T): () => T {
	let instance: T | null = null;
	return () => {
		if (instance === null) {
			instance = factory();
		}
		return instance;
	};
}

const zenProviders = {
	anthropic: lazy<AnthropicProvider>(() =>
		createAnthropic({
			fetch: fetchWithLogging,
			apiKey: requireEnv("OPENCODE_API_KEY"),
			baseURL: ZEN_BASE,
		}),
	),
	openai: lazy<OpenAIProvider>(() =>
		createOpenAI({
			fetch: fetchWithLogging,
			apiKey: requireEnv("OPENCODE_API_KEY"),
			baseURL: ZEN_BASE,
		}),
	),
	google: lazy<GoogleProvider>(() =>
		createGoogleGenerativeAI({
			fetch: fetchWithLogging,
			apiKey: requireEnv("OPENCODE_API_KEY"),
			baseURL: ZEN_BASE,
		}),
	),
	compat: lazy<OpenAICompatProvider>(() =>
		createOpenAICompatible({
			fetch: fetchWithLogging,
			name: "zen-compat",
			apiKey: requireEnv("OPENCODE_API_KEY"),
			baseURL: ZEN_BASE,
		}),
	),
};

const directProviders = {
	anthropic: lazy<AnthropicProvider>(() =>
		createAnthropic({
			fetch: fetchWithLogging,
			apiKey: requireEnv("ANTHROPIC_API_KEY"),
		}),
	),
	openai: lazy<OpenAIProvider>(() =>
		createOpenAI({
			fetch: fetchWithLogging,
			apiKey: requireEnv("OPENAI_API_KEY"),
		}),
	),
	google: lazy<GoogleProvider>(() =>
		createGoogleGenerativeAI({
			fetch: fetchWithLogging,
			apiKey: requireAnyEnv(["GOOGLE_API_KEY", "GEMINI_API_KEY"]),
		}),
	),
	ollama: lazy<OpenAICompatProvider>(() => {
		const baseURL = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
		return createOpenAICompatible({
			name: "ollama",
			baseURL: `${baseURL}/v1`,
			apiKey: "ollama",
			fetch: fetchWithLogging,
		});
	}),
};

function resolveZenModel(modelId: string): LanguageModel {
	switch (getZenBackend(modelId)) {
		case "anthropic":
			return zenProviders.anthropic()(modelId);
		case "openai":
			return zenProviders.openai().responses(modelId);
		case "google":
			return zenProviders.google()(modelId);
		case "compat":
			return zenProviders.compat()(modelId);
	}
}

function resolveOpenAIModel(modelId: string): LanguageModel {
	return modelId.startsWith("gpt-")
		? directProviders.openai().responses(modelId)
		: directProviders.openai()(modelId);
}

const PROVIDER_MODEL_RESOLVERS: Readonly<
	Record<ProviderName, (modelId: string) => LanguageModel>
> = {
	zen: resolveZenModel,
	anthropic: (modelId) => directProviders.anthropic()(modelId),
	openai: resolveOpenAIModel,
	google: (modelId) => directProviders.google()(modelId),
	ollama: (modelId) => directProviders.ollama().chatModel(modelId),
};

function isProviderName(provider: string): provider is ProviderName {
	return SUPPORTED_PROVIDERS.includes(provider as ProviderName);
}

export function resolveModel(modelString: string): LanguageModel {
	const slashIdx = modelString.indexOf("/");
	if (slashIdx === -1) {
		throw new Error(
			`Invalid model string "${modelString}". Expected format: "<provider>/<model-id>"`,
		);
	}

	const provider = modelString.slice(0, slashIdx);
	const modelId = modelString.slice(slashIdx + 1);

	if (!isProviderName(provider)) {
		throw new Error(
			`Unknown provider "${provider}". Supported: ${SUPPORTED_PROVIDERS.join(", ")}`,
		);
	}

	return PROVIDER_MODEL_RESOLVERS[provider](modelId);
}

export function autoDiscoverModel(): string {
	if (process.env.OPENCODE_API_KEY) return "zen/claude-sonnet-4-6";
	if (process.env.ANTHROPIC_API_KEY)
		return "anthropic/claude-sonnet-4-5-20250929";
	if (process.env.OPENAI_API_KEY) return "openai/gpt-4o";
	if (process.env.GOOGLE_API_KEY ?? process.env.GEMINI_API_KEY)
		return "google/gemini-2.0-flash";
	return "ollama/llama3.2";
}

export async function fetchAvailableModels(): Promise<AvailableModelsSnapshot> {
	return fetchAvailableModelsSnapshot();
}
