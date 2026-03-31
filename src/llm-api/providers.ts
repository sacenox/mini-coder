import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import { getAccessToken, isLoggedIn } from "../session/oauth/auth-storage.ts";
import { extractAccountId } from "../session/oauth/openai.ts";
import {
  type AvailableModelsSnapshot,
  fetchAvailableModelsSnapshot,
} from "./model-info.ts";
import { getZenBackend } from "./model-routing.ts";
import {
  type ConnectedProvider,
  discoverProviderConnections,
} from "./provider-discovery.ts";

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

function createOAuthOpenAIProvider(token: string): OpenAIProvider {
  const accountId = extractAccountId(token);
  return createOpenAI({
    apiKey: "oauth",
    baseURL: OPENAI_CODEX_BASE_URL,
    fetch: ((
      input: Parameters<ProviderFetch>[0],
      init?: Parameters<ProviderFetch>[1],
    ) => {
      const h = new Headers(
        init?.headers as ConstructorParameters<typeof Headers>[0],
      );
      h.delete("OpenAI-Organization");
      h.delete("OpenAI-Project");
      h.set("Authorization", `Bearer ${token}`);
      if (accountId) h.set("chatgpt-account-id", accountId);

      // Transform request body for Codex backend compatibility:
      // 1. Move developer/system message from input[] to top-level `instructions`
      // 2. Strip unsupported parameters (max_output_tokens, store)
      let body = init?.body;
      if (typeof body === "string") {
        try {
          const parsed = JSON.parse(body);
          if (parsed.input && Array.isArray(parsed.input)) {
            if (!parsed.instructions) {
              const sysIdx = parsed.input.findIndex(
                (m: Record<string, string>) =>
                  m.role === "developer" || m.role === "system",
              );
              if (sysIdx !== -1) {
                const sysMsg = parsed.input[sysIdx];
                parsed.instructions =
                  typeof sysMsg.content === "string"
                    ? sysMsg.content
                    : JSON.stringify(sysMsg.content);
                parsed.input.splice(sysIdx, 1);
              }
            }
            delete parsed.max_output_tokens;
            parsed.store = false;
            parsed.stream = true;
            body = JSON.stringify(parsed);
          }
        } catch {
          // not JSON, pass through
        }
      }

      return fetch(input, {
        ...init,
        body,
        headers: Object.fromEntries(h.entries()),
      });
    }) as ProviderFetch,
  });
}

async function resolveOpenAIModel(modelId: string): Promise<LanguageModel> {
  // OAuth token takes priority over env var
  if (isLoggedIn("openai")) {
    const token = await getAccessToken("openai");
    if (token) {
      if (!oauthOpenAICache || oauthOpenAICache.token !== token) {
        oauthOpenAICache = {
          token,
          provider: createOAuthOpenAIProvider(token),
        };
      }
      return oauthOpenAICache.provider.responses(modelId);
    }
  }
  // Fallback to OPENAI_API_KEY env var
  return modelId.startsWith("gpt-")
    ? directProviders.openai().responses(modelId)
    : directProviders.openai()(modelId);
}

type AsyncModelResolver = (
  modelId: string,
) => LanguageModel | Promise<LanguageModel>;

const OPENAI_CODEX_BASE_URL = "https://chatgpt.com/backend-api/codex";

/** Cache the OAuth-backed OpenAI Codex provider keyed by access token. */
let oauthOpenAICache: { token: string; provider: OpenAIProvider } | null = null;

async function resolveAnthropicModel(modelId: string): Promise<LanguageModel> {
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

/** Returns providers that are available via env, OAuth, or local-server discovery. */
export async function discoverConnectedProviders(): Promise<
  ConnectedProvider[]
> {
  return discoverProviderConnections(process.env, {
    openaiLoggedIn: isLoggedIn("openai"),
  });
}

export function autoDiscoverModel(): string {
  if (process.env.OPENCODE_API_KEY) return "zen/claude-sonnet-4-6";
  if (process.env.ANTHROPIC_API_KEY) return "anthropic/claude-sonnet-4-6";
  if (process.env.OPENAI_API_KEY || isLoggedIn("openai"))
    return "openai/gpt-5.4";
  if (process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY)
    return "google/gemini-3.1-pro";
  return "ollama/llama3.2";
}

export async function fetchAvailableModels(): Promise<AvailableModelsSnapshot> {
  return fetchAvailableModelsSnapshot();
}
