import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import { createOllama } from "ollama-ai-provider";

// ─── Zen endpoint constants ────────────────────────────────────────────────────

const ZEN_BASE = "https://opencode.ai/zen/v1";

// Zen endpoint routing — matched in order, fallthrough to OpenAI-compatible
function zenEndpointFor(modelId: string) {
	if (modelId.startsWith("claude-")) return zenAnthropic()(modelId);
	if (modelId.startsWith("gpt-")) return zenOpenAI()(modelId);
	if (modelId.startsWith("gemini-")) return zenGoogle()(modelId);
	return zenCompat()(modelId);
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
		_directAnthropic = createAnthropic({ apiKey: key });
	}
	return _directAnthropic;
}

function directOpenAI() {
	if (!_directOpenAI) {
		const key = process.env.OPENAI_API_KEY;
		if (!key) throw new Error("OPENAI_API_KEY is not set");
		_directOpenAI = createOpenAI({ apiKey: key });
	}
	return _directOpenAI;
}

function directGoogle() {
	if (!_directGoogle) {
		const key = process.env.GOOGLE_API_KEY ?? process.env.GEMINI_API_KEY;
		if (!key) throw new Error("GOOGLE_API_KEY or GEMINI_API_KEY is not set");
		_directGoogle = createGoogleGenerativeAI({ apiKey: key });
	}
	return _directGoogle;
}

// ─── Context window table ─────────────────────────────────────────────────────
// Maps model ID substrings (matched in order) to token limits.
// Covers all Zen models plus common direct-provider model families.
// When a model isn't matched, callers fall back to showing raw token counts.

const CONTEXT_WINDOW_TABLE: Array<[pattern: RegExp, tokens: number]> = [
	// Claude — all modern models are 200k
	[/^claude-/, 200_000],
	// Gemini — all Gemini 3.x are 1M
	[/^gemini-/, 1_000_000],
	// GPT-5 series — 128k
	[/^gpt-5/, 128_000],
	// GPT-4o / GPT-4 series — 128k
	[/^gpt-4/, 128_000],
	// Kimi K2 / K2.5 — 262k
	[/^kimi-k2/, 262_000],
	// MiniMax M2 — 196k
	[/^minimax-m2/, 196_000],
	// GLM 5 / 4.x — 128k
	[/^glm-/, 128_000],
	// Qwen3 Coder — 131k (Qwen3 standard)
	[/^qwen3-/, 131_000],
];

/**
 * Return the known context window size (in tokens) for a model string.
 * Accepts either a bare model ID or a "provider/model-id" string.
 * Returns null when the model is unknown.
 */
export function getContextWindow(modelString: string): number | null {
	const modelId = modelString.includes("/")
		? modelString.slice(modelString.indexOf("/") + 1)
		: modelString;
	for (const [pattern, tokens] of CONTEXT_WINDOW_TABLE) {
		if (pattern.test(modelId)) return tokens;
	}
	return null;
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
			return directOpenAI()(modelId);

		case "google":
			return directGoogle()(modelId);

		case "ollama": {
			const baseURL = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
			const ollamaProvider = createOllama({ baseURL });
			// ollama-ai-provider returns LanguageModelV1; cast to LanguageModel
			return ollamaProvider(modelId) as unknown as LanguageModel;
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

/**
 * List all providers that appear to be configured via ENV.
 */
export function availableProviders(): string[] {
	const providers: string[] = [];
	if (process.env.OPENCODE_API_KEY) providers.push("zen");
	if (process.env.ANTHROPIC_API_KEY) providers.push("anthropic");
	if (process.env.OPENAI_API_KEY) providers.push("openai");
	if (process.env.GOOGLE_API_KEY ?? process.env.GEMINI_API_KEY)
		providers.push("google");
	providers.push("ollama"); // always listed (local)
	return providers;
}

// ─── Live model listing ───────────────────────────────────────────────────────

export interface LiveModel {
	id: string;
	displayName: string;
	provider: string;
	context?: number | undefined;
	free?: boolean | undefined;
}

/** Fetch live model list from OpenCode Zen */
async function fetchZenModels(): Promise<LiveModel[]> {
	const key = process.env.OPENCODE_API_KEY;
	if (!key) return [];
	try {
		const res = await fetch(`${ZEN_BASE}/models`, {
			headers: { Authorization: `Bearer ${key}` },
			signal: AbortSignal.timeout(8000),
		});
		if (!res.ok) return [];
		const json = (await res.json()) as {
			data?: Array<{ id: string; context_window?: number }>;
		};
		const models = json.data ?? [];
		return models.map((m) => ({
			id: `zen/${m.id}`,
			displayName: m.id,
			provider: "zen",
			context: m.context_window,
			free:
				m.id.endsWith("-free") ||
				m.id === "gpt-5-nano" ||
				m.id === "big-pickle",
		}));
	} catch {
		return [];
	}
}

/** Fetch live model list from local Ollama */
async function fetchOllamaModels(): Promise<LiveModel[]> {
	const base = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
	try {
		const res = await fetch(`${base}/api/tags`, {
			signal: AbortSignal.timeout(3000),
		});
		if (!res.ok) return [];
		const json = (await res.json()) as {
			models?: Array<{ name: string; details?: { parameter_size?: string } }>;
		};
		return (json.models ?? []).map((m) => ({
			id: `ollama/${m.name}`,
			displayName:
				m.name +
				(m.details?.parameter_size ? ` (${m.details.parameter_size})` : ""),
			provider: "ollama",
		}));
	} catch {
		return [];
	}
}

/**
 * Fetch live model lists from all configured providers.
 * Falls back to an empty array per provider on error.
 */
export async function fetchAvailableModels(): Promise<LiveModel[]> {
	const [zen, ollama] = await Promise.all([
		fetchZenModels(),
		fetchOllamaModels(),
	]);
	return [...zen, ...ollama];
}
