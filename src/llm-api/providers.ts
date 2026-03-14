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

type ProviderName = "zen" | "anthropic" | "openai" | "google" | "ollama";

const ZEN_BASE = "https://opencode.ai/zen/v1";

function getFetchWithLogging(): typeof fetch {
	const customFetch = async (
		input: Parameters<typeof fetch>[0],
		init?: Parameters<typeof fetch>[1],
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
	return customFetch as unknown as typeof fetch;
}

const fetchWithLogging = getFetchWithLogging();

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

let _zenAnthropic: ReturnType<typeof createAnthropic> | null = null;
let _zenOpenAI: ReturnType<typeof createOpenAI> | null = null;
let _zenGoogle: ReturnType<typeof createGoogleGenerativeAI> | null = null;
let _zenCompat: ReturnType<typeof createOpenAICompatible> | null = null;

function zenAnthropic() {
	if (!_zenAnthropic) {
		_zenAnthropic = createAnthropic({
			fetch: fetchWithLogging,
			apiKey: requireEnv("OPENCODE_API_KEY"),
			baseURL: ZEN_BASE,
		});
	}
	return _zenAnthropic;
}

function zenOpenAI() {
	if (!_zenOpenAI) {
		_zenOpenAI = createOpenAI({
			fetch: fetchWithLogging,
			apiKey: requireEnv("OPENCODE_API_KEY"),
			baseURL: ZEN_BASE,
		});
	}
	return _zenOpenAI;
}

function zenGoogle() {
	if (!_zenGoogle) {
		_zenGoogle = createGoogleGenerativeAI({
			fetch: fetchWithLogging,
			apiKey: requireEnv("OPENCODE_API_KEY"),
			baseURL: ZEN_BASE,
		});
	}
	return _zenGoogle;
}

function zenCompat() {
	if (!_zenCompat) {
		_zenCompat = createOpenAICompatible({
			fetch: fetchWithLogging,
			name: "zen-compat",
			apiKey: requireEnv("OPENCODE_API_KEY"),
			baseURL: ZEN_BASE,
		});
	}
	return _zenCompat;
}

let _directAnthropic: ReturnType<typeof createAnthropic> | null = null;
let _directOpenAI: ReturnType<typeof createOpenAI> | null = null;
let _directGoogle: ReturnType<typeof createGoogleGenerativeAI> | null = null;
let _ollama: ReturnType<typeof createOpenAICompatible> | null = null;

function directAnthropic() {
	if (!_directAnthropic) {
		_directAnthropic = createAnthropic({
			fetch: fetchWithLogging,
			apiKey: requireEnv("ANTHROPIC_API_KEY"),
		});
	}
	return _directAnthropic;
}

function directOpenAI() {
	if (!_directOpenAI) {
		_directOpenAI = createOpenAI({
			fetch: fetchWithLogging,
			apiKey: requireEnv("OPENAI_API_KEY"),
		});
	}
	return _directOpenAI;
}

function directGoogle() {
	if (!_directGoogle) {
		_directGoogle = createGoogleGenerativeAI({
			fetch: fetchWithLogging,
			apiKey: requireAnyEnv(["GOOGLE_API_KEY", "GEMINI_API_KEY"]),
		});
	}
	return _directGoogle;
}

function ollamaProvider() {
	if (!_ollama) {
		const baseURL = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
		_ollama = createOpenAICompatible({
			name: "ollama",
			baseURL: `${baseURL}/v1`,
			apiKey: "ollama",
			fetch: fetchWithLogging,
		});
	}
	return _ollama;
}

function resolveZenModel(modelId: string): LanguageModel {
	switch (getZenBackend(modelId)) {
		case "anthropic":
			return zenAnthropic()(modelId);
		case "openai":
			return zenOpenAI().responses(modelId);
		case "google":
			return zenGoogle()(modelId);
		case "compat":
			return zenCompat()(modelId);
	}
}

function resolveOpenAIModel(modelId: string): LanguageModel {
	return modelId.startsWith("gpt-")
		? directOpenAI().responses(modelId)
		: directOpenAI()(modelId);
}

function resolveProviderModel(
	provider: ProviderName,
	modelId: string,
): LanguageModel {
	switch (provider) {
		case "zen":
			return resolveZenModel(modelId);
		case "anthropic":
			return directAnthropic()(modelId);
		case "openai":
			return resolveOpenAIModel(modelId);
		case "google":
			return directGoogle()(modelId);
		case "ollama":
			return ollamaProvider().chatModel(modelId);
	}
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

	if (
		provider !== "zen" &&
		provider !== "anthropic" &&
		provider !== "openai" &&
		provider !== "google" &&
		provider !== "ollama"
	) {
		throw new Error(
			`Unknown provider "${provider}". Supported: zen, anthropic, openai, google, ollama`,
		);
	}

	return resolveProviderModel(provider, modelId);
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
