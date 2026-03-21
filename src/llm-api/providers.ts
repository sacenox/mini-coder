import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import { getAccessToken, isLoggedIn } from "../session/oauth/auth-storage.ts";
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
type ModelResolver = (modelId: string) => LanguageModel;

/** Betas the AI SDK adds that are not compatible with the OAuth endpoint. */
const OAUTH_STRIP_BETAS = new Set<string>();

function createOAuthFetch(accessToken: string): ProviderFetch {
  const oauthFetch = async (
    input: Parameters<ProviderFetch>[0],
    init?: Parameters<ProviderFetch>[1],
  ): Promise<Response> => {
    let opts = init;
    if (opts?.headers) {
      const h = new Headers(
        opts.headers as ConstructorParameters<typeof Headers>[0],
      );
      const beta = h.get("anthropic-beta");
      if (beta) {
        const filtered = beta
          .split(",")
          .filter((b) => !OAUTH_STRIP_BETAS.has(b))
          .join(",");
        h.set("anthropic-beta", filtered);
      }
      h.delete("x-api-key");
      h.set("authorization", `Bearer ${accessToken}`);
      h.set("user-agent", "claude-cli/2.1.75");
      h.set("x-app", "cli");
      opts = { ...opts, headers: Object.fromEntries(h.entries()) };
    }
    return fetch(input, opts);
  };
  return oauthFetch as ProviderFetch;
}

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
      fetch,
      apiKey: requireEnv("OPENCODE_API_KEY"),
      baseURL: ZEN_BASE,
    }),
  ),
  openai: lazy<OpenAIProvider>(() =>
    createOpenAI({
      fetch,
      apiKey: requireEnv("OPENCODE_API_KEY"),
      baseURL: ZEN_BASE,
    }),
  ),
  google: lazy<GoogleProvider>(() =>
    createGoogleGenerativeAI({
      fetch,
      apiKey: requireEnv("OPENCODE_API_KEY"),
      baseURL: ZEN_BASE,
    }),
  ),
  compat: lazy<OpenAICompatProvider>(() =>
    createOpenAICompatible({
      fetch,
      name: "zen-compat",
      apiKey: requireEnv("OPENCODE_API_KEY"),
      baseURL: ZEN_BASE,
    }),
  ),
};

const directProviders = {
  anthropic: lazy<AnthropicProvider>(() =>
    createAnthropic({
      fetch,
      apiKey: requireEnv("ANTHROPIC_API_KEY"),
    }),
  ),
  openai: lazy<OpenAIProvider>(() =>
    createOpenAI({
      fetch,
      apiKey: requireEnv("OPENAI_API_KEY"),
    }),
  ),
  google: lazy<GoogleProvider>(() =>
    createGoogleGenerativeAI({
      fetch,
      apiKey: requireAnyEnv(["GOOGLE_API_KEY", "GEMINI_API_KEY"]),
    }),
  ),
  ollama: lazy<OpenAICompatProvider>(() => {
    const baseURL = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
    return createOpenAICompatible({
      name: "ollama",
      baseURL: `${baseURL}/v1`,
      apiKey: "ollama",
      fetch,
    });
  }),
};

const ZEN_BACKEND_RESOLVERS: Readonly<
  Record<ReturnType<typeof getZenBackend>, ModelResolver>
> = {
  anthropic: (modelId) => zenProviders.anthropic()(modelId),
  openai: (modelId) => zenProviders.openai().responses(modelId),
  google: (modelId) => zenProviders.google()(modelId),
  compat: (modelId) => zenProviders.compat()(modelId),
};

function resolveZenModel(modelId: string): LanguageModel {
  return ZEN_BACKEND_RESOLVERS[getZenBackend(modelId)](modelId);
}

function resolveOpenAIModel(modelId: string): LanguageModel {
  return modelId.startsWith("gpt-")
    ? directProviders.openai().responses(modelId)
    : directProviders.openai()(modelId);
}

type AsyncModelResolver = (
  modelId: string,
) => LanguageModel | Promise<LanguageModel>;

/** Cache the OAuth-backed Anthropic provider keyed by access token. */
let oauthAnthropicCache: { token: string; provider: AnthropicProvider } | null =
  null;

function createOAuthAnthropicProvider(token: string): AnthropicProvider {
  return createAnthropic({
    // Use empty apiKey + custom fetch (like opencode) instead of authToken.
    // The SDK sends x-api-key for apiKey, which we override to Authorization
    // Bearer in the OAuth fetch wrapper.
    apiKey: "",
    fetch: createOAuthFetch(token),
    headers: {
      "anthropic-beta": "claude-code-20250219,oauth-2025-04-20",
    },
  });
}

async function resolveAnthropicModel(modelId: string): Promise<LanguageModel> {
  // OAuth token takes priority over env var
  if (isLoggedIn("anthropic")) {
    const token = await getAccessToken("anthropic");
    if (token) {
      if (!oauthAnthropicCache || oauthAnthropicCache.token !== token) {
        oauthAnthropicCache = {
          token,
          provider: createOAuthAnthropicProvider(token),
        };
      }
      return oauthAnthropicCache.provider(modelId);
    }
  }
  // Fallback to ANTHROPIC_API_KEY env var
  return directProviders.anthropic()(modelId);
}

const PROVIDER_MODEL_RESOLVERS: Readonly<
  Record<ProviderName, AsyncModelResolver>
> = {
  zen: resolveZenModel,
  anthropic: resolveAnthropicModel,
  openai: resolveOpenAIModel,
  google: (modelId) => directProviders.google()(modelId),
  ollama: (modelId) => directProviders.ollama().chatModel(modelId),
};

function isProviderName(provider: string): provider is ProviderName {
  return SUPPORTED_PROVIDERS.includes(provider as ProviderName);
}

export async function resolveModel(
  modelString: string,
): Promise<LanguageModel> {
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

/** Returns true when the Anthropic provider is using an OAuth token. */
export function isAnthropicOAuth(): boolean {
  return isLoggedIn("anthropic");
}

interface ConnectedProvider {
  name: string;
  via: "env" | "oauth";
}

/** Returns providers that have credentials available (env key or OAuth token). */
export function discoverConnectedProviders(): ConnectedProvider[] {
  const result: ConnectedProvider[] = [];
  if (process.env.OPENCODE_API_KEY) result.push({ name: "zen", via: "env" });
  if (isLoggedIn("anthropic")) result.push({ name: "anthropic", via: "oauth" });
  else if (process.env.ANTHROPIC_API_KEY)
    result.push({ name: "anthropic", via: "env" });
  if (process.env.OPENAI_API_KEY) result.push({ name: "openai", via: "env" });
  if (process.env.GOOGLE_API_KEY ?? process.env.GEMINI_API_KEY)
    result.push({ name: "google", via: "env" });
  if (process.env.OLLAMA_BASE_URL) result.push({ name: "ollama", via: "env" });
  return result;
}

export function autoDiscoverModel(): string {
  if (process.env.OPENCODE_API_KEY) return "zen/claude-sonnet-4-6";
  if (process.env.ANTHROPIC_API_KEY || isLoggedIn("anthropic"))
    return "anthropic/claude-sonnet-4-6";
  if (process.env.OPENAI_API_KEY) return "openai/gpt-5.4";
  if (process.env.GOOGLE_API_KEY ?? process.env.GEMINI_API_KEY)
    return "google/gemini-3.1-pro";
  return "ollama/llama3.2";
}

export async function fetchAvailableModels(): Promise<AvailableModelsSnapshot> {
  return fetchAvailableModelsSnapshot();
}
