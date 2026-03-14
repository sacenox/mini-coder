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

// ─── Zen endpoint constants ────────────────────────────────────────────────────

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

const ZEN_BASE = "https://opencode.ai/zen/v1";

// Zen endpoint routing — matched in order, fallthrough to OpenAI-compatible
function zenEndpointFor(modelId: string) {
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

// ─── Lazy provider factories (created on first use) ───────────────────────────

let _zenAnthropic: ReturnType<typeof createAnthropic> | null = null;
let _zenOpenAI: ReturnType<typeof createOpenAI> | null = null;
let _zenGoogle: ReturnType<typeof createGoogleGenerativeAI> | null = null;

let _zenCompat: ReturnType<typeof createOpenAICompatible> | null = null;

function getZenApiKey(): string {
	const key = process.env.OPENCODE_API_KEY;
	if (!key) throw new Error("OPENCODE_API_KEY is not set");
	return key;
}

function zenAnthropic() {
	if (!_zenAnthropic) {
		// @ai-sdk/anthropic appends /messages automatically — baseURL is the v1 root
		_zenAnthropic = createAnthropic({
			fetch: getFetchWithLogging(),
			apiKey: getZenApiKey(),
			baseURL: ZEN_BASE,
		});
	}
	return _zenAnthropic;
}

function zenOpenAI() {
	if (!_zenOpenAI) {
		// @ai-sdk/openai appends /responses automatically — baseURL is the v1 root
		_zenOpenAI = createOpenAI({
			fetch: getFetchWithLogging(),
			apiKey: getZenApiKey(),
			baseURL: ZEN_BASE,
		});
	}
	return _zenOpenAI;
}

function zenGoogle() {
	if (!_zenGoogle) {
		// @ai-sdk/google constructs its own path; we pass the base up to /models
		_zenGoogle = createGoogleGenerativeAI({
			fetch: getFetchWithLogging(),
			apiKey: getZenApiKey(),
			baseURL: ZEN_BASE,
		});
	}
	return _zenGoogle;
}

function zenCompat() {
	if (!_zenCompat) {
		// @ai-sdk/openai-compatible appends /chat/completions — baseURL is the v1 root
		_zenCompat = createOpenAICompatible({
			fetch: getFetchWithLogging(),
			name: "zen-compat",
			apiKey: getZenApiKey(),
			baseURL: ZEN_BASE,
		});
	}
	return _zenCompat;
}

// ─── Direct provider factories ────────────────────────────────────────────────

let _directAnthropic: ReturnType<typeof createAnthropic> | null = null;
let _directOpenAI: ReturnType<typeof createOpenAI> | null = null;
let _directGoogle: ReturnType<typeof createGoogleGenerativeAI> | null = null;

function directAnthropic() {
	if (!_directAnthropic) {
		const key = process.env.ANTHROPIC_API_KEY;
		if (!key) throw new Error("ANTHROPIC_API_KEY is not set");
		_directAnthropic = createAnthropic({
			fetch: getFetchWithLogging(),
			apiKey: key,
		});
	}
	return _directAnthropic;
}

function directOpenAI() {
	if (!_directOpenAI) {
		const key = process.env.OPENAI_API_KEY;
		if (!key) throw new Error("OPENAI_API_KEY is not set");
		_directOpenAI = createOpenAI({ fetch: getFetchWithLogging(), apiKey: key });
	}
	return _directOpenAI;
}

function directGoogle() {
	if (!_directGoogle) {
		const key = process.env.GOOGLE_API_KEY ?? process.env.GEMINI_API_KEY;
		if (!key) throw new Error("GOOGLE_API_KEY or GEMINI_API_KEY is not set");
		_directGoogle = createGoogleGenerativeAI({
			fetch: getFetchWithLogging(),
			apiKey: key,
		});
	}
	return _directGoogle;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Resolve a model string to a LanguageModel.
 *
 * Format:  "<provider>/<model-id>"
 *
 * Providers:
 *   zen/<model-id>      – OpenCode Zen (requires OPENCODE_API_KEY)
 *   anthropic/<model>   – Direct Anthropic (requires ANTHROPIC_API_KEY)
 *   openai/<model>      – Direct OpenAI (requires OPENAI_API_KEY)
 *   google/<model>      – Direct Google (requires GOOGLE_API_KEY or GEMINI_API_KEY)
 *   ollama/<model>      – Local Ollama
 */
export function resolveModel(modelString: string): LanguageModel {
	const slashIdx = modelString.indexOf("/");
	if (slashIdx === -1) {
		throw new Error(
			`Invalid model string "${modelString}". Expected format: "<provider>/<model-id>"`,
		);
	}

	const provider = modelString.slice(0, slashIdx);
	const modelId = modelString.slice(slashIdx + 1);

	switch (provider) {
		case "zen": {
			return zenEndpointFor(modelId);
		}

		case "anthropic":
			return directAnthropic()(modelId);

		case "openai":
			return modelId.startsWith("gpt-")
				? directOpenAI().responses(modelId)
				: directOpenAI()(modelId);

		case "google":
			return directGoogle()(modelId);

		case "ollama": {
			const baseURL = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
			const ollamaProvider = createOpenAICompatible({
				name: "ollama",
				baseURL: `${baseURL}/v1`,
				apiKey: "ollama",
				fetch: getFetchWithLogging(),
			});
			return ollamaProvider.chatModel(modelId);
		}

		default:
			throw new Error(
				`Unknown provider "${provider}". Supported: zen, anthropic, openai, google, ollama`,
			);
	}
}

/**
 * Auto-discover a usable provider from the environment.
 * Returns the first available (provider, defaultModel) pair.
 */
export function autoDiscoverModel(): string {
	if (process.env.OPENCODE_API_KEY) return "zen/claude-sonnet-4-6";
	if (process.env.ANTHROPIC_API_KEY)
		return "anthropic/claude-sonnet-4-5-20250929";
	if (process.env.OPENAI_API_KEY) return "openai/gpt-4o";
	if (process.env.GOOGLE_API_KEY ?? process.env.GEMINI_API_KEY)
		return "google/gemini-2.0-flash";
	// Always fall back to Ollama (may fail at request time if not running)
	return "ollama/llama3.2";
}

// ─── Cached model listing ─────────────────────────────────────────────────────

export async function fetchAvailableModels(): Promise<AvailableModelsSnapshot> {
	return fetchAvailableModelsSnapshot();
}
