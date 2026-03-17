import { getAccessToken, isLoggedIn } from "../oauth/auth-storage.ts";

const ZEN_BASE = "https://opencode.ai/zen/v1";
const OPENAI_BASE = "https://api.openai.com";
const ANTHROPIC_BASE = "https://api.anthropic.com";
const GOOGLE_BASE = "https://generativelanguage.googleapis.com/v1beta";
const MODELS_DEV_URL = "https://models.dev/api.json";

export interface ProviderModelCandidate {
	providerModelId: string;
	displayName: string;
	contextWindow: number | null;
	free: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function normalizeModelId(modelId: string): string {
	let out = modelId.trim().toLowerCase();
	while (out.startsWith("models/")) {
		out = out.slice("models/".length);
	}
	return out;
}

async function fetchJson(
	url: string,
	init: RequestInit,
	timeoutMs: number,
): Promise<unknown | null> {
	try {
		const response = await fetch(url, {
			...init,
			signal: AbortSignal.timeout(timeoutMs),
		});
		if (!response.ok) return null;
		return (await response.json()) as unknown;
	} catch {
		return null;
	}
}

export async function fetchModelsDevPayload(): Promise<unknown | null> {
	return fetchJson(MODELS_DEV_URL, {}, 10_000);
}

function processModelsList(
	payload: unknown,
	arrayKey: string,
	idKey: string,
	mapper: (
		item: Record<string, unknown>,
		modelId: string,
	) => ProviderModelCandidate | null,
): ProviderModelCandidate[] | null {
	if (!isRecord(payload) || !Array.isArray(payload[arrayKey])) return null;
	const out: ProviderModelCandidate[] = [];
	for (const item of payload[arrayKey] as unknown[]) {
		if (!isRecord(item) || typeof item[idKey] !== "string") continue;
		const modelId = normalizeModelId(item[idKey] as string);
		if (!modelId) continue;
		const mapped = mapper(item as Record<string, unknown>, modelId);
		if (mapped) out.push(mapped);
	}
	return out;
}

async function fetchPaginatedModelsList(
	url: string,
	init: RequestInit,
	timeoutMs: number,
	arrayKey: string,
	idKey: string,
	mapper: (
		item: Record<string, unknown>,
		modelId: string,
	) => ProviderModelCandidate | null,
): Promise<ProviderModelCandidate[] | null> {
	const out: ProviderModelCandidate[] = [];
	const seen = new Set<string>();
	const baseUrl = new URL(url);
	let nextAfter: string | null = null;

	for (let page = 0; page < 10; page += 1) {
		const currentUrl = new URL(baseUrl);
		if (nextAfter !== null) currentUrl.searchParams.set("after", nextAfter);
		const payload = await fetchJson(currentUrl.toString(), init, timeoutMs);
		const rows = processModelsList(payload, arrayKey, idKey, mapper);
		if (rows === null) return null;
		for (const row of rows) {
			if (seen.has(row.providerModelId)) continue;
			seen.add(row.providerModelId);
			out.push(row);
		}
		if (!isRecord(payload)) break;
		if (payload.has_more !== true || typeof payload.last_id !== "string") break;
		nextAfter = payload.last_id;
	}

	return out;
}

async function fetchZenModels(): Promise<ProviderModelCandidate[] | null> {
	const key = process.env.OPENCODE_API_KEY;
	if (!key) return null;
	return fetchPaginatedModelsList(
		`${ZEN_BASE}/models`,
		{ headers: { Authorization: `Bearer ${key}` } },
		8_000,
		"data",
		"id",
		(item, modelId) => {
			const contextWindow =
				typeof item.context_window === "number" &&
				Number.isFinite(item.context_window)
					? Math.max(0, Math.trunc(item.context_window))
					: null;
			return {
				providerModelId: modelId,
				displayName: item.id as string,
				contextWindow,
				free:
					(item.id as string).endsWith("-free") ||
					item.id === "gpt-5-nano" ||
					item.id === "big-pickle",
			};
		},
	);
}

async function fetchOpenAIModels(): Promise<ProviderModelCandidate[] | null> {
	const key = process.env.OPENAI_API_KEY;
	if (!key) return null;
	return fetchPaginatedModelsList(
		`${OPENAI_BASE}/v1/models`,
		{ headers: { Authorization: `Bearer ${key}` } },
		6_000,
		"data",
		"id",
		(_item, modelId) => ({
			providerModelId: modelId,
			displayName: modelId,
			contextWindow: null,
			free: false,
		}),
	);
}

async function getAnthropicAuth(): Promise<{
	key: string;
	oauth: boolean;
} | null> {
	const envKey = process.env.ANTHROPIC_API_KEY;
	if (envKey) return { key: envKey, oauth: false };
	if (isLoggedIn("anthropic")) {
		const token = await getAccessToken("anthropic");
		if (token) return { key: token, oauth: true };
	}
	return null;
}

async function fetchAnthropicModels(): Promise<
	ProviderModelCandidate[] | null
> {
	const auth = await getAnthropicAuth();
	if (!auth) return null;

	const headers: Record<string, string> = {
		"anthropic-version": "2023-06-01",
	};
	if (auth.oauth) {
		headers.Authorization = `Bearer ${auth.key}`;
		headers["anthropic-beta"] = "oauth-2025-04-20";
	} else {
		headers["x-api-key"] = auth.key;
	}

	const payload = await fetchJson(
		`${ANTHROPIC_BASE}/v1/models`,
		{ headers },
		6_000,
	);
	return processModelsList(payload, "data", "id", (item, modelId) => {
		const displayName =
			typeof item.display_name === "string" &&
			item.display_name.trim().length > 0
				? item.display_name
				: modelId;
		return {
			providerModelId: modelId,
			displayName,
			contextWindow: null,
			free: false,
		};
	});
}

async function fetchGoogleModels(): Promise<ProviderModelCandidate[] | null> {
	const key = process.env.GOOGLE_API_KEY ?? process.env.GEMINI_API_KEY;
	if (!key) return null;
	const payload = await fetchJson(
		`${GOOGLE_BASE}/models?key=${encodeURIComponent(key)}`,
		{},
		6_000,
	);
	return processModelsList(payload, "models", "name", (item, modelId) => {
		const displayName =
			typeof item.displayName === "string" && item.displayName.trim().length > 0
				? item.displayName
				: modelId;
		const contextWindow =
			typeof item.inputTokenLimit === "number" &&
			Number.isFinite(item.inputTokenLimit)
				? Math.max(0, Math.trunc(item.inputTokenLimit))
				: null;
		return {
			providerModelId: modelId,
			displayName,
			contextWindow,
			free: false,
		};
	});
}

async function fetchOllamaModels(): Promise<ProviderModelCandidate[] | null> {
	const base = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
	const payload = await fetchJson(`${base}/api/tags`, {}, 3_000);
	return processModelsList(payload, "models", "name", (item, modelId) => {
		const details = item.details;
		let sizeSuffix = "";
		if (isRecord(details) && typeof details.parameter_size === "string") {
			sizeSuffix = ` (${details.parameter_size})`;
		}
		return {
			providerModelId: modelId,
			displayName: `${item.name as string}${sizeSuffix}`,
			contextWindow: null,
			free: false,
		};
	});
}

const PROVIDER_CANDIDATE_FETCHERS: Readonly<
	Record<string, () => Promise<ProviderModelCandidate[] | null>>
> = {
	zen: fetchZenModels,
	openai: fetchOpenAIModels,
	anthropic: fetchAnthropicModels,
	google: fetchGoogleModels,
	ollama: fetchOllamaModels,
};

export async function fetchProviderCandidates(
	provider: string,
): Promise<ProviderModelCandidate[] | null> {
	const fetcher = PROVIDER_CANDIDATE_FETCHERS[provider];
	if (!fetcher) return null;
	return fetcher();
}
