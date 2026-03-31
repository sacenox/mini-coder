export type ProviderConnectionKind = "env" | "oauth" | "local";

export interface ConnectedProvider {
  name: string;
  via: ProviderConnectionKind;
}

const DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434";
export const LOCAL_PROVIDER_CACHE_TTL_MS = 30_000;
const LOCAL_PROVIDER_TIMEOUT_MS = 300;
const knownLocalProviders = new Set<string>();
let knownLocalProvidersRefreshedAt = 0;

const REMOTE_PROVIDER_ENV_KEYS: ReadonlyArray<{
  provider: string;
  envKeys: readonly string[];
}> = [
  { provider: "zen", envKeys: ["OPENCODE_API_KEY"] },
  { provider: "openai", envKeys: ["OPENAI_API_KEY"] },
  { provider: "anthropic", envKeys: ["ANTHROPIC_API_KEY"] },
  { provider: "google", envKeys: ["GOOGLE_API_KEY", "GEMINI_API_KEY"] },
];

function hasAnyEnvKey(
  env: Record<string, string | undefined>,
  keys: readonly string[],
): boolean {
  for (const key of keys) {
    if (env[key]) return true;
  }
  return false;
}

function appendUnique(target: string[], value: string): void {
  if (!target.includes(value)) target.push(value);
}

async function canReachOllama(
  env: Record<string, string | undefined>,
): Promise<boolean> {
  try {
    const response = await fetch(
      new URL("/api/tags", env.OLLAMA_BASE_URL ?? DEFAULT_OLLAMA_BASE_URL),
      { signal: AbortSignal.timeout(LOCAL_PROVIDER_TIMEOUT_MS) },
    );
    return response.ok;
  } catch {
    return false;
  }
}

export function getRemoteConfiguredProviders(
  env: Record<string, string | undefined>,
  opts?: { openaiLoggedIn?: boolean },
): string[] {
  const providers = REMOTE_PROVIDER_ENV_KEYS.filter((entry) =>
    hasAnyEnvKey(env, entry.envKeys),
  ).map((entry) => entry.provider);

  if (!providers.includes("openai") && opts?.openaiLoggedIn) {
    providers.push("openai");
  }

  return providers;
}

export function isLocalProviderConnectionStateStale(now = Date.now()): boolean {
  return now - knownLocalProvidersRefreshedAt > LOCAL_PROVIDER_CACHE_TTL_MS;
}

export function getKnownLocalProviders(now = Date.now()): string[] {
  if (isLocalProviderConnectionStateStale(now)) return [];
  return Array.from(knownLocalProviders).sort((a, b) => a.localeCompare(b));
}

export async function refreshLocalProviderConnections(
  env: Record<string, string | undefined>,
  now = Date.now(),
): Promise<string[]> {
  const localProviders: string[] = [];
  if (await canReachOllama(env)) localProviders.push("ollama");

  knownLocalProviders.clear();
  for (const provider of localProviders) knownLocalProviders.add(provider);
  knownLocalProvidersRefreshedAt = now;
  return localProviders;
}

export function getLocalProviderNames(
  connectedProviders: readonly ConnectedProvider[],
): string[] {
  return connectedProviders
    .filter((provider) => provider.via === "local")
    .map((provider) => provider.name)
    .sort((a, b) => a.localeCompare(b));
}

export function getVisibleProviders(
  env: Record<string, string | undefined>,
  opts?: {
    openaiLoggedIn?: boolean;
    localProviders?: readonly string[];
    now?: number;
  },
): string[] {
  const providers = getRemoteConfiguredProviders(env, opts);
  for (const provider of opts?.localProviders ??
    getKnownLocalProviders(opts?.now)) {
    appendUnique(providers, provider);
  }
  return providers;
}

export async function discoverProviderConnections(
  env: Record<string, string | undefined>,
  opts?: {
    openaiLoggedIn?: boolean;
    localProviders?: readonly string[];
    now?: number;
  },
): Promise<ConnectedProvider[]> {
  const result: ConnectedProvider[] = [];

  if (env.OPENCODE_API_KEY) result.push({ name: "zen", via: "env" });
  if (env.ANTHROPIC_API_KEY) result.push({ name: "anthropic", via: "env" });
  if (opts?.openaiLoggedIn) result.push({ name: "openai", via: "oauth" });
  else if (env.OPENAI_API_KEY) result.push({ name: "openai", via: "env" });
  if (env.GOOGLE_API_KEY || env.GEMINI_API_KEY) {
    result.push({ name: "google", via: "env" });
  }

  const localProviders =
    opts?.localProviders ??
    (await refreshLocalProviderConnections(env, opts?.now));
  for (const provider of localProviders) {
    result.push({ name: provider, via: "local" });
  }
  return result;
}
