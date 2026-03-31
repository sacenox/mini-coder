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
import {
  getKnownLocalProviders,
  getRemoteConfiguredProviders,
  getVisibleProviders,
  isLocalProviderConnectionStateStale,
  refreshLocalProviderConnections,
} from "./provider-discovery.ts";

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

export function getRemoteProvidersFromEnv(
  env: Record<string, string | undefined>,
): string[] {
  return getRemoteConfiguredProviders(env, {
    openaiLoggedIn: isLoggedIn("openai"),
  });
}

export function getProvidersToRefreshFromEnv(
  env: Record<string, string | undefined>,
  opts?: { localProviders?: readonly string[] },
): string[] {
  const localProviders = opts?.localProviders;
  return getVisibleProviders(env, {
    openaiLoggedIn: isLoggedIn("openai"),
    ...(localProviders ? { localProviders } : {}),
  });
}

function getVisibleProvidersForSnapshotFromEnv(
  env: Record<string, string | undefined>,
  opts?: { localProviders?: readonly string[] },
): ReadonlySet<string> {
  const localProviders = opts?.localProviders;
  return new Set(
    getProvidersToRefreshFromEnv(
      env,
      localProviders ? { localProviders } : undefined,
    ),
  );
}

export function isProviderVisibleInSnapshot(
  provider: string,
  env: Record<string, string | undefined>,
  opts?: { localProviders?: readonly string[] },
): boolean {
  return getVisibleProvidersForSnapshotFromEnv(env, opts).has(provider);
}

function getConfiguredProvidersForSync(
  localProviders?: readonly string[],
): string[] {
  return getProvidersToRefreshFromEnv(
    process.env,
    localProviders ? { localProviders } : undefined,
  );
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
  if (isLocalProviderConnectionStateStale(now)) return true;
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

async function refreshModelInfoInternal(
  localProviders?: readonly string[],
): Promise<void> {
  ensureLoaded();
  const now = Date.now();
  const discoveredLocalProviders =
    localProviders ?? (await refreshLocalProviderConnections(process.env));
  const providers = getConfiguredProvidersForSync(discoveredLocalProviders);
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
  localProviders?: readonly string[];
}): Promise<void> {
  ensureLoaded();
  const force = opts?.force ?? false;
  if (
    !force &&
    !isModelInfoStale() &&
    !shouldBlockOnMissingVisibleProviderModels({
      hasAnyCachedModels: runtimeCache.providerModelsByKey.size > 0,
      hasCachedModelsForAllVisibleProviders:
        hasCachedModelsForAllVisibleProviders(),
    })
  ) {
    return Promise.resolve();
  }
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = refreshModelInfoInternal(opts?.localProviders).finally(
    () => {
      refreshInFlight = null;
    },
  );
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
  const visible = getVisibleProvidersForSnapshotFromEnv(process.env, {
    localProviders: getKnownLocalProviders(),
  });
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
  const visible = getVisibleProvidersForSnapshotFromEnv(process.env, {
    localProviders: getKnownLocalProviders(),
  });
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

export function shouldBlockOnMissingVisibleProviderModels(opts: {
  hasAnyCachedModels: boolean;
  hasCachedModelsForAllVisibleProviders: boolean;
}): boolean {
  return (
    !opts.hasAnyCachedModels || !opts.hasCachedModelsForAllVisibleProviders
  );
}

export async function fetchAvailableModelsSnapshot(): Promise<AvailableModelsSnapshot> {
  ensureLoaded();
  const stale = isModelInfoStale();
  const shouldBlock = shouldBlockOnMissingVisibleProviderModels({
    hasAnyCachedModels: runtimeCache.providerModelsByKey.size > 0,
    hasCachedModelsForAllVisibleProviders:
      hasCachedModelsForAllVisibleProviders(),
  });

  if (shouldBlock) {
    await refreshModelInfoInBackground({ force: true });
  } else if (stale && !isModelInfoRefreshing()) {
    void refreshModelInfoInBackground();
  }

  return {
    models: readLiveModelsFromCache(
      runtimeCache,
      getVisibleProvidersForSnapshotFromEnv(process.env, {
        localProviders: getKnownLocalProviders(),
      }),
    ),
    stale: isModelInfoStale(),
    refreshing: isModelInfoRefreshing(),
    lastSyncAt: getLastSyncAt(),
  };
}
