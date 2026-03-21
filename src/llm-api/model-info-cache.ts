import type {
  ModelCapabilityRow,
  ProviderModelRow,
} from "../session/db/model-info-repo.ts";
import {
  buildModelMatchIndex,
  type ModelMatchIndex,
  matchCanonicalModelId,
  normalizeModelId,
} from "./model-info-normalize.ts";

export interface ModelInfo {
  canonicalModelId: string | null;
  contextWindow: number | null;
  maxOutputTokens: number | null;
  reasoning: boolean;
}

export interface LiveModel {
  id: string;
  displayName: string;
  provider: string;
  context?: number | undefined;
  free?: boolean | undefined;
}

interface RuntimeCapability {
  canonicalModelId: string;
  contextWindow: number | null;
  maxOutputTokens: number | null;
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

export interface RuntimeCache {
  capabilitiesByCanonical: Map<string, RuntimeCapability>;
  providerModelsByKey: Map<string, RuntimeProviderModel>;
  providerModelUniqIndex: Map<string, string | null>;
  matchIndex: ModelMatchIndex;
  state: Map<string, string>;
}

interface ParsedModelString {
  provider: string | null;
  modelId: string;
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

export function emptyRuntimeCache(): RuntimeCache {
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

export function buildRuntimeCache(
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
      maxOutputTokens: row.max_output_tokens,
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
        maxOutputTokens: capability.maxOutputTokens,
        reasoning: capability.reasoning,
      };
    }
  }
  return {
    canonicalModelId: row.canonicalModelId,
    contextWindow: row.contextWindow,
    maxOutputTokens: null,
    reasoning: false,
  };
}

export function resolveModelInfoInCache(
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
        maxOutputTokens: capability.maxOutputTokens,
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

export function readLiveModelsFromCache(
  cache: RuntimeCache,
  visibleProviders: ReadonlySet<string>,
): LiveModel[] {
  const models: LiveModel[] = [];
  for (const row of cache.providerModelsByKey.values()) {
    if (!visibleProviders.has(row.provider)) continue;
    const info = resolveFromProviderRow(row, cache);
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
