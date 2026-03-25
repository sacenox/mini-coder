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
import { isLoggedIn } from "../session/oauth/auth-storage.ts";
import {
  buildRuntimeCache,
  emptyRuntimeCache,
  type LiveModel,
  type ModelInfo,
  type RuntimeCache,
  readLiveModelsFromCache,
  resolveModelInfoInCache,
} from "./model-info-cache.ts";
import {
  fetchModelsDevPayload,
  fetchProviderCandidates,
  type ProviderModelCandidate,
} from "./model-info-fetch.ts";
import {
  buildModelMatchIndex,
  type ModelMatchIndex,
  matchCanonicalModelId,
  parseModelsDevCapabilities,
} from "./model-info-normalize.ts";

const MODELS_DEV_SYNC_KEY = "last_models_dev_sync_at";
const PROVIDER_SYNC_KEY_PREFIX = "last_provider_sync_at:";
const CACHE_VERSION_KEY = "model_info_cache_version";
const CACHE_VERSION = 5;
export const MODEL_INFO_TTL_MS = 24 * 60 * 60 * 1000;

export {
  buildModelMatchIndex,
  matchCanonicalModelId,
  normalizeModelId,
  parseModelsDevCapabilities,
} from "./model-info-normalize.ts";
export type { LiveModel };

const REMOTE_PROVIDER_ENV_KEYS: ReadonlyArray<{
  provider: string;
  envKeys: readonly string[];
}> = [
  { provider: "zen", envKeys: ["OPENCODE_API_KEY"] },
  { provider: "openai", envKeys: ["OPENAI_API_KEY"] },
  { provider: "anthropic", envKeys: ["ANTHROPIC_API_KEY"] },
  { provider: "google", envKeys: ["GOOGLE_API_KEY", "GEMINI_API_KEY"] },
];

export interface AvailableModelsSnapshot {
  models: LiveModel[];
  stale: boolean;
  refreshing: boolean;
  lastSyncAt: number | null;
}

let runtimeCache: RuntimeCache = emptyRuntimeCache();
let loaded = false;
let refreshInFlight: Promise<void> | null = null;

export function isStaleTimestamp(
  timestamp: number | null,
  now = Date.now(),
  ttlMs = MODEL_INFO_TTL_MS,
): boolean {
  if (timestamp === null) return true;
  return now - timestamp > ttlMs;
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
  const providers = REMOTE_PROVIDER_ENV_KEYS.filter((entry) =>
    hasAnyEnvKey(env, entry.envKeys),
  ).map((entry) => entry.provider);

  // Include providers with OAuth login even without env keys
  for (const p of ["anthropic", "openai"] as const) {
    if (!providers.includes(p) && isLoggedIn(p)) {
      providers.push(p);
    }
  }

  return providers;
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

export function getMaxOutputTokens(modelString: string): number | null {
  return resolveModelInfo(modelString)?.maxOutputTokens ?? null;
}

export function supportsThinking(modelString: string): boolean {
  return resolveModelInfo(modelString)?.reasoning ?? false;
}

/** Return cached model IDs synchronously (for Tab-completion). */
export function getCachedModelIds(): string[] {
  ensureLoaded();
  const visible = getVisibleProvidersForSnapshotFromEnv(process.env);
  const ids: string[] = [];
  for (const row of runtimeCache.providerModelsByKey.values()) {
    if (visible.has(row.provider)) {
      ids.push(`${row.provider}/${row.providerModelId}`);
    }
  }
  ids.sort((a, b) => a.localeCompare(b));
  return ids;
}

function hasCachedModelsForAllVisibleProviders(): boolean {
  const visible = getVisibleProvidersForSnapshotFromEnv(process.env);
  for (const provider of visible) {
    let found = false;
    for (const row of runtimeCache.providerModelsByKey.values()) {
      if (row.provider === provider) {
        found = true;
        break;
      }
    }
    if (!found) return false;
  }
  return true;
}

export async function fetchAvailableModelsSnapshot(): Promise<AvailableModelsSnapshot> {
  ensureLoaded();
  if (isModelInfoStale() && !isModelInfoRefreshing()) {
    // Block when the cache is empty or a visible provider has no cached models
    // (e.g. user just logged in via OAuth). Otherwise refresh in background.
    if (
      runtimeCache.providerModelsByKey.size === 0 ||
      !hasCachedModelsForAllVisibleProviders()
    ) {
      await refreshModelInfoInBackground({ force: true });
    } else {
      void refreshModelInfoInBackground();
    }
  }
  return {
    models: readLiveModelsFromCache(
      runtimeCache,
      getVisibleProvidersForSnapshotFromEnv(process.env),
    ),
    stale: isModelInfoStale(),
    refreshing: isModelInfoRefreshing(),
    lastSyncAt: getLastSyncAt(),
  };
}
