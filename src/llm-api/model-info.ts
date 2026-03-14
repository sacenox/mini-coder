import {
	listModelCapabilities,
	listModelInfoState,
	listProviderModels,
	type ModelCapabilityRow,
	type ProviderModelRow,
	replaceModelCapabilities,
	replaceProviderModels,
	setModelInfoState,
} from "../session/db/model-info-repo.ts";

const ZEN_BASE = "https://opencode.ai/zen/v1";
const OPENAI_BASE = "https://api.openai.com";
const ANTHROPIC_BASE = "https://api.anthropic.com";
const GOOGLE_BASE = "https://generativelanguage.googleapis.com/v1beta";
const MODELS_DEV_URL = "https://models.dev/api.json";

const MODELS_DEV_SYNC_KEY = "last_models_dev_sync_at";
const PROVIDER_SYNC_KEY_PREFIX = "last_provider_sync_at:";
const CACHE_VERSION_KEY = "model_info_cache_version";
const CACHE_VERSION = 2;
export const MODEL_INFO_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const REMOTE_PROVIDER_ENV_KEYS: ReadonlyArray<{
	provider: string;
	envKeys: readonly string[];
}> = [
	{ provider: "zen", envKeys: ["OPENCODE_API_KEY"] },
	{ provider: "openai", envKeys: ["OPENAI_API_KEY"] },
	{ provider: "anthropic", envKeys: ["ANTHROPIC_API_KEY"] },
	{ provider: "google", envKeys: ["GOOGLE_API_KEY", "GEMINI_API_KEY"] },
];

interface ModelInfo {
	canonicalModelId: string | null;
	contextWindow: number | null;
	reasoning: boolean;
}

export interface LiveModel {
	id: string;
	displayName: string;
	provider: string;
	context?: number | undefined;
	free?: boolean | undefined;
}

export interface AvailableModelsSnapshot {
	models: LiveModel[];
	stale: boolean;
	refreshing: boolean;
	lastSyncAt: number | null;
}

interface RuntimeCapability {
	canonicalModelId: string;
	contextWindow: number | null;
	reasoning: boolean;
	sourceProvider: string | null;
}

interface RuntimeProviderModel {
	provider: string;
	providerModelId: string;
	displayName: string;
	canonicalModelId: string | null;
	contextWindow: number | null;
	free: boolean;
}

interface RuntimeCache {
	capabilitiesByCanonical: Map<string, RuntimeCapability>;
	providerModelsByKey: Map<string, RuntimeProviderModel>;
	providerModelUniqIndex: Map<string, string | null>;
	matchIndex: ModelMatchIndex;
	state: Map<string, string>;
}

interface ModelMatchIndex {
	exact: Map<string, string>;
	alias: Map<string, string | null>;
}

interface ModelsDevEntry {
	canonicalModelId: string;
	contextWindow: number | null;
	reasoning: boolean;
	sourceProvider: string;
	rawJson: string | null;
}

interface ProviderModelCandidate {
	providerModelId: string;
	displayName: string;
	contextWindow: number | null;
	free: boolean;
}

interface ParsedModelString {
	provider: string | null;
	modelId: string;
}

let runtimeCache: RuntimeCache = emptyRuntimeCache();
let loaded = false;
let refreshInFlight: Promise<void> | null = null;

function emptyRuntimeCache(): RuntimeCache {
	return {
		capabilitiesByCanonical: new Map<string, RuntimeCapability>(),
		providerModelsByKey: new Map<string, RuntimeProviderModel>(),
		providerModelUniqIndex: new Map<string, string | null>(),
		matchIndex: {
			exact: new Map<string, string>(),
			alias: new Map<string, string | null>(),
		},
		state: new Map<string, string>(),
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function parseModelStringLoose(modelString: string): ParsedModelString {
	const slash = modelString.indexOf("/");
	if (slash === -1) {
		return { provider: null, modelId: modelString };
	}
	const provider = modelString.slice(0, slash).trim().toLowerCase();
	const modelId = modelString.slice(slash + 1);
	return { provider: provider || null, modelId };
}

function providerModelKey(provider: string, modelId: string): string {
	return `${provider}/${modelId}`;
}

function basename(value: string): string {
	const idx = value.lastIndexOf("/");
	return idx === -1 ? value : value.slice(idx + 1);
}

export function normalizeModelId(modelId: string): string {
	let out = modelId.trim().toLowerCase();
	while (out.startsWith("models/")) {
		out = out.slice("models/".length);
	}
	return out;
}

function parseContextWindow(model: Record<string, unknown>): number | null {
	const limit = model.limit;
	if (!isRecord(limit)) return null;
	const context = limit.context;
	if (typeof context !== "number" || !Number.isFinite(context)) return null;
	return Math.max(0, Math.trunc(context));
}

export function parseModelsDevCapabilities(
	payload: unknown,
	updatedAt: number,
): ModelCapabilityRow[] {
	if (!isRecord(payload)) return [];

	const merged = new Map<string, ModelsDevEntry>();
	for (const [provider, providerValue] of Object.entries(payload)) {
		if (!isRecord(providerValue)) continue;
		const models = providerValue.models;
		if (!isRecord(models)) continue;
		for (const [modelKey, modelValue] of Object.entries(models)) {
			if (!isRecord(modelValue)) continue;
			const explicitId =
				typeof modelValue.id === "string" && modelValue.id.trim().length > 0
					? modelValue.id
					: modelKey;
			const canonicalModelId = normalizeModelId(explicitId);
			if (!canonicalModelId) continue;
			const contextWindow = parseContextWindow(modelValue);
			const reasoning = modelValue.reasoning === true;
			const rawJson = JSON.stringify(modelValue);
			const prev = merged.get(canonicalModelId);
			if (!prev) {
				merged.set(canonicalModelId, {
					canonicalModelId,
					contextWindow,
					reasoning,
					sourceProvider: provider,
					rawJson,
				});
				continue;
			}
			merged.set(canonicalModelId, {
				canonicalModelId,
				contextWindow: prev.contextWindow ?? contextWindow,
				reasoning: prev.reasoning || reasoning,
				sourceProvider: prev.sourceProvider,
				rawJson: prev.rawJson ?? rawJson,
			});
		}
	}

	return Array.from(merged.values()).map((entry) => ({
		canonical_model_id: entry.canonicalModelId,
		context_window: entry.contextWindow,
		reasoning: entry.reasoning ? 1 : 0,
		source_provider: entry.sourceProvider,
		raw_json: entry.rawJson,
		updated_at: updatedAt,
	}));
}

export function buildModelMatchIndex(
	canonicalModelIds: Iterable<string>,
): ModelMatchIndex {
	const exact = new Map<string, string>();
	const aliasCandidates = new Map<string, Set<string>>();

	for (const rawCanonical of canonicalModelIds) {
		const canonical = normalizeModelId(rawCanonical);
		if (!canonical) continue;
		exact.set(canonical, canonical);
		const short = basename(canonical);
		if (!short) continue;
		let set = aliasCandidates.get(short);
		if (!set) {
			set = new Set<string>();
			aliasCandidates.set(short, set);
		}
		set.add(canonical);
	}

	const alias = new Map<string, string | null>();
	for (const [short, candidates] of aliasCandidates) {
		if (candidates.size === 1) {
			for (const value of candidates) {
				alias.set(short, value);
			}
		} else {
			alias.set(short, null);
		}
	}

	return { exact, alias };
}

export function matchCanonicalModelId(
	providerModelId: string,
	index: ModelMatchIndex,
): string | null {
	const normalized = normalizeModelId(providerModelId);
	if (!normalized) return null;
	const exactMatch = index.exact.get(normalized);
	if (exactMatch) return exactMatch;
	const short = basename(normalized);
	if (!short) return null;
	const alias = index.alias.get(short);
	return alias ?? null;
}

export function isStaleTimestamp(
	timestamp: number | null,
	now = Date.now(),
	ttlMs = MODEL_INFO_TTL_MS,
): boolean {
	if (timestamp === null) return true;
	return now - timestamp > ttlMs;
}

function buildRuntimeCache(
	capabilityRows: ModelCapabilityRow[],
	providerRows: ProviderModelRow[],
	stateRows: Array<{ key: string; value: string }>,
): RuntimeCache {
	const capabilitiesByCanonical = new Map<string, RuntimeCapability>();
	for (const row of capabilityRows) {
		const canonical = normalizeModelId(row.canonical_model_id);
		if (!canonical) continue;
		capabilitiesByCanonical.set(canonical, {
			canonicalModelId: canonical,
			contextWindow: row.context_window,
			reasoning: row.reasoning === 1,
			sourceProvider: row.source_provider,
		});
	}

	const providerModelsByKey = new Map<string, RuntimeProviderModel>();
	const providerModelUniqIndex = new Map<string, string | null>();
	for (const row of providerRows) {
		const provider = row.provider.trim().toLowerCase();
		const providerModelId = normalizeModelId(row.provider_model_id);
		if (!provider || !providerModelId) continue;
		const key = providerModelKey(provider, providerModelId);
		providerModelsByKey.set(key, {
			provider,
			providerModelId,
			displayName: row.display_name,
			canonicalModelId: row.canonical_model_id
				? normalizeModelId(row.canonical_model_id)
				: null,
			contextWindow: row.context_window,
			free: row.free === 1,
		});
		const prev = providerModelUniqIndex.get(providerModelId);
		if (prev === undefined) {
			providerModelUniqIndex.set(providerModelId, key);
		} else if (prev !== key) {
			providerModelUniqIndex.set(providerModelId, null);
		}
	}

	const matchIndex = buildModelMatchIndex(capabilitiesByCanonical.keys());
	const state = new Map<string, string>();
	for (const row of stateRows) {
		state.set(row.key, row.value);
	}

	return {
		capabilitiesByCanonical,
		providerModelsByKey,
		providerModelUniqIndex,
		matchIndex,
		state,
	};
}

function loadCacheFromDb(): void {
	runtimeCache = buildRuntimeCache(
		listModelCapabilities(),
		listProviderModels(),
		listModelInfoState(),
	);
	loaded = true;
}

function ensureLoaded(): void {
	if (!loaded) loadCacheFromDb();
}

export function initModelInfoCache(): void {
	loadCacheFromDb();
}

function parseStateInt(key: string): number | null {
	const raw = runtimeCache.state.get(key);
	if (!raw) return null;
	const value = Number.parseInt(raw, 10);
	if (!Number.isFinite(value)) return null;
	return value;
}

function hasAnyEnvKey(
	env: Record<string, string | undefined>,
	keys: readonly string[],
): boolean {
	for (const key of keys) {
		if (env[key]) return true;
	}
	return false;
}

export function getRemoteProvidersFromEnv(
	env: Record<string, string | undefined>,
): string[] {
	return REMOTE_PROVIDER_ENV_KEYS.filter((entry) =>
		hasAnyEnvKey(env, entry.envKeys),
	).map((entry) => entry.provider);
}

export function getProvidersToRefreshFromEnv(
	env: Record<string, string | undefined>,
): string[] {
	return [...getRemoteProvidersFromEnv(env), "ollama"];
}

function getVisibleProvidersForSnapshotFromEnv(
	env: Record<string, string | undefined>,
): ReadonlySet<string> {
	return new Set(getProvidersToRefreshFromEnv(env));
}

export function isProviderVisibleInSnapshot(
	provider: string,
	env: Record<string, string | undefined>,
): boolean {
	return getVisibleProvidersForSnapshotFromEnv(env).has(provider);
}

function getConfiguredProvidersForSync(): string[] {
	return getProvidersToRefreshFromEnv(process.env);
}

function getProvidersRequiredForFreshness(): string[] {
	return getRemoteProvidersFromEnv(process.env);
}

function getProviderSyncKey(provider: string): string {
	return `${PROVIDER_SYNC_KEY_PREFIX}${provider}`;
}

function isModelInfoStale(now = Date.now()): boolean {
	ensureLoaded();
	if (parseStateInt(CACHE_VERSION_KEY) !== CACHE_VERSION) return true;
	if (isStaleTimestamp(parseStateInt(MODELS_DEV_SYNC_KEY), now)) return true;
	for (const provider of getProvidersRequiredForFreshness()) {
		const providerSync = parseStateInt(getProviderSyncKey(provider));
		if (isStaleTimestamp(providerSync, now)) return true;
	}
	return false;
}

function getLastSyncAt(): number | null {
	let latest = parseStateInt(MODELS_DEV_SYNC_KEY);
	for (const provider of getProvidersRequiredForFreshness()) {
		const value = parseStateInt(getProviderSyncKey(provider));
		if (value !== null && (latest === null || value > latest)) latest = value;
	}
	return latest;
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

async function fetchModelsDevPayload(): Promise<unknown | null> {
	return fetchJson(MODELS_DEV_URL, {}, 10_000);
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
		if (rows === null) {
			return null;
		}
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

async function fetchOpenAIModels(): Promise<ProviderModelCandidate[] | null> {
	const key = process.env.OPENAI_API_KEY;
	if (!key) return null;
	return fetchPaginatedModelsList(
		`${OPENAI_BASE}/v1/models`,
		{ headers: { Authorization: `Bearer ${key}` } },
		6_000,
		"data",
		"id",
		(item, modelId) => ({
			providerModelId: modelId,
			displayName: item.id as string,
			contextWindow: null,
			free: false,
		}),
	);
}

async function fetchAnthropicModels(): Promise<
	ProviderModelCandidate[] | null
> {
	const key = process.env.ANTHROPIC_API_KEY;
	if (!key) return null;
	const payload = await fetchJson(
		`${ANTHROPIC_BASE}/v1/models`,
		{
			headers: {
				"x-api-key": key,
				"anthropic-version": "2023-06-01",
			},
		},
		6_000,
	);
	return processModelsList(payload, "data", "id", (item, modelId) => {
		const displayName =
			typeof item.display_name === "string" &&
			item.display_name.trim().length > 0
				? item.display_name
				: (item.id as string);
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

async function fetchProviderCandidates(
	provider: string,
): Promise<ProviderModelCandidate[] | null> {
	const fetcher = PROVIDER_CANDIDATE_FETCHERS[provider];
	if (!fetcher) return null;
	return fetcher();
}

function providerRowsFromCandidates(
	candidates: ProviderModelCandidate[],
	matchIndex: ModelMatchIndex,
	updatedAt: number,
): Omit<ProviderModelRow, "provider">[] {
	return candidates.map((candidate) => ({
		provider_model_id: candidate.providerModelId,
		display_name: candidate.displayName,
		canonical_model_id: matchCanonicalModelId(
			candidate.providerModelId,
			matchIndex,
		),
		context_window: candidate.contextWindow,
		free: candidate.free ? 1 : 0,
		updated_at: updatedAt,
	}));
}

async function refreshModelInfoInternal(): Promise<void> {
	ensureLoaded();
	const now = Date.now();
	const providers = getConfiguredProvidersForSync();
	const providerResults = await Promise.all(
		providers.map(async (provider) => ({
			provider,
			candidates: await fetchProviderCandidates(provider),
		})),
	);

	const modelsDevPayload = await fetchModelsDevPayload();
	let matchIndex = runtimeCache.matchIndex;
	if (modelsDevPayload !== null) {
		const capabilityRows = parseModelsDevCapabilities(modelsDevPayload, now);
		if (capabilityRows.length > 0) {
			replaceModelCapabilities(capabilityRows);
			setModelInfoState(MODELS_DEV_SYNC_KEY, String(now));
			matchIndex = buildModelMatchIndex(
				capabilityRows.map((row) => row.canonical_model_id),
			);
		}
	}

	for (const result of providerResults) {
		if (result.candidates === null) continue;
		const rows = providerRowsFromCandidates(result.candidates, matchIndex, now);
		replaceProviderModels(result.provider, rows);
		setModelInfoState(getProviderSyncKey(result.provider), String(now));
	}
	setModelInfoState(CACHE_VERSION_KEY, String(CACHE_VERSION));

	loadCacheFromDb();
}

export function refreshModelInfoInBackground(opts?: {
	force?: boolean;
}): Promise<void> {
	ensureLoaded();
	const force = opts?.force ?? false;
	if (!force && !isModelInfoStale()) return Promise.resolve();
	if (refreshInFlight) return refreshInFlight;
	refreshInFlight = refreshModelInfoInternal().finally(() => {
		refreshInFlight = null;
	});
	return refreshInFlight;
}

function isModelInfoRefreshing(): boolean {
	return refreshInFlight !== null;
}

function resolveFromProviderRow(
	row: RuntimeProviderModel,
	cache: RuntimeCache,
): ModelInfo {
	if (row.canonicalModelId) {
		const capability = cache.capabilitiesByCanonical.get(row.canonicalModelId);
		if (capability) {
			return {
				canonicalModelId: capability.canonicalModelId,
				contextWindow: capability.contextWindow ?? row.contextWindow,
				reasoning: capability.reasoning,
			};
		}
	}
	return {
		canonicalModelId: row.canonicalModelId,
		contextWindow: row.contextWindow,
		reasoning: false,
	};
}

function resolveModelInfoInCache(
	modelString: string,
	cache: RuntimeCache,
): ModelInfo | null {
	const parsed = parseModelStringLoose(modelString);
	const normalizedModelId = normalizeModelId(parsed.modelId);
	if (!normalizedModelId) return null;

	if (parsed.provider) {
		const providerRow = cache.providerModelsByKey.get(
			providerModelKey(parsed.provider, normalizedModelId),
		);
		if (providerRow) return resolveFromProviderRow(providerRow, cache);
	}

	const canonical = matchCanonicalModelId(normalizedModelId, cache.matchIndex);
	if (canonical) {
		const capability = cache.capabilitiesByCanonical.get(canonical);
		if (capability) {
			return {
				canonicalModelId: capability.canonicalModelId,
				contextWindow: capability.contextWindow,
				reasoning: capability.reasoning,
			};
		}
	}

	if (!parsed.provider) {
		const uniqueProviderKey =
			cache.providerModelUniqIndex.get(normalizedModelId);
		if (uniqueProviderKey) {
			const providerRow = cache.providerModelsByKey.get(uniqueProviderKey);
			if (providerRow) return resolveFromProviderRow(providerRow, cache);
		}
	}

	return null;
}

function resolveModelInfo(modelString: string): ModelInfo | null {
	ensureLoaded();
	return resolveModelInfoInCache(modelString, runtimeCache);
}

export function resolveModelInfoFromRows(
	modelString: string,
	capabilityRows: ModelCapabilityRow[],
	providerRows: ProviderModelRow[],
	stateRows: Array<{ key: string; value: string }> = [],
): ModelInfo | null {
	const cache = buildRuntimeCache(capabilityRows, providerRows, stateRows);
	return resolveModelInfoInCache(modelString, cache);
}

export function getContextWindow(modelString: string): number | null {
	return resolveModelInfo(modelString)?.contextWindow ?? null;
}

export function supportsThinking(modelString: string): boolean {
	return resolveModelInfo(modelString)?.reasoning ?? false;
}

function readLiveModelsFromCache(): LiveModel[] {
	const models: LiveModel[] = [];
	const visibleProviders = getVisibleProvidersForSnapshotFromEnv(process.env);
	for (const row of runtimeCache.providerModelsByKey.values()) {
		if (!visibleProviders.has(row.provider)) continue;
		const info = resolveFromProviderRow(row, runtimeCache);
		models.push({
			id: `${row.provider}/${row.providerModelId}`,
			displayName: row.displayName,
			provider: row.provider,
			context: info.contextWindow ?? undefined,
			free: row.free ? true : undefined,
		});
	}
	models.sort(
		(a, b) => a.provider.localeCompare(b.provider) || a.id.localeCompare(b.id),
	);
	return models;
}

export async function fetchAvailableModelsSnapshot(): Promise<AvailableModelsSnapshot> {
	ensureLoaded();
	if (isModelInfoStale() && !isModelInfoRefreshing()) {
		if (runtimeCache.providerModelsByKey.size === 0) {
			await refreshModelInfoInBackground({ force: true });
		} else {
			void refreshModelInfoInBackground();
		}
	}
	return {
		models: readLiveModelsFromCache(),
		stale: isModelInfoStale(),
		refreshing: isModelInfoRefreshing(),
		lastSyncAt: getLastSyncAt(),
	};
}
