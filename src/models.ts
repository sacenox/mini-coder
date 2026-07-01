import type {
  Api,
  Credential,
  CredentialStore,
  KnownApi,
  KnownProvider,
  Model,
  ProviderStreams,
} from "@earendil-works/pi-ai";
import { createProvider } from "@earendil-works/pi-ai";
import { anthropicMessagesApi } from "@earendil-works/pi-ai/api/anthropic-messages.lazy";
import { azureOpenAIResponsesApi } from "@earendil-works/pi-ai/api/azure-openai-responses.lazy";
import { bedrockConverseStreamApi } from "@earendil-works/pi-ai/api/bedrock-converse-stream.lazy";
import { googleGenerativeAIApi } from "@earendil-works/pi-ai/api/google-generative-ai.lazy";
import { googleVertexApi } from "@earendil-works/pi-ai/api/google-vertex.lazy";
import { mistralConversationsApi } from "@earendil-works/pi-ai/api/mistral-conversations.lazy";
import { openAICodexResponsesApi } from "@earendil-works/pi-ai/api/openai-codex-responses.lazy";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { openAIResponsesApi } from "@earendil-works/pi-ai/api/openai-responses.lazy";
import {
  builtinModels,
  getBuiltinModels,
  getBuiltinProviders,
} from "@earendil-works/pi-ai/providers/all";
import { AUTH_PATH } from "./shared.ts";

const API_STREAMS: Record<KnownApi, () => ProviderStreams> = {
  "anthropic-messages": anthropicMessagesApi,
  "azure-openai-responses": azureOpenAIResponsesApi,
  "bedrock-converse-stream": bedrockConverseStreamApi,
  "google-generative-ai": googleGenerativeAIApi,
  "google-vertex": googleVertexApi,
  "mistral-conversations": mistralConversationsApi,
  "openai-codex-responses": openAICodexResponsesApi,
  "openai-completions": openAICompletionsApi,
  "openai-responses": openAIResponsesApi,
};

type SavedCredentials = Record<string, Credential>;

async function readCredentials(): Promise<SavedCredentials> {
  const file = Bun.file(AUTH_PATH);
  if (await file.exists()) {
    return JSON.parse(await file.text()) as SavedCredentials;
  }

  return {};
}

async function writeCredentials(credentials: SavedCredentials) {
  await Bun.write(AUTH_PATH, JSON.stringify(credentials));
}

export function createCredentialStore(): CredentialStore {
  return {
    async read(providerId) {
      const credentials = await readCredentials();
      return credentials[providerId];
    },

    async modify(providerId, fn) {
      const credentials = await readCredentials();
      const next = await fn(credentials[providerId]);

      if (next) {
        credentials[providerId] = next;
        await writeCredentials(credentials);
      }

      return credentials[providerId];
    },

    async delete(providerId) {
      const credentials = await readCredentials();
      delete credentials[providerId];
      await writeCredentials(credentials);
    },
  };
}

export function isBuiltinProvider(provider: string): provider is KnownProvider {
  return getBuiltinProviders().includes(provider as KnownProvider);
}

export function findModelConfig(
  modelId: string,
  provider: string,
  customProviders?: Model<Api>[],
) {
  if (isBuiltinProvider(provider)) {
    const models = getBuiltinModels(provider);
    if (models.length === 0) throw new Error("Provider has no models");
    return models.find((m) => m.id === modelId);
  }
  return customProviders?.find(
    (m) => m.provider === provider && m.id === modelId,
  );
}

export function getFirstModelConfig(
  provider: string,
  customProviders?: Model<Api>[],
): Model<Api> {
  if (isBuiltinProvider(provider)) {
    const models = getBuiltinModels(provider);
    if (models.length > 0) return models[0];
  }
  const custom = customProviders?.find((m) => m.provider === provider);
  if (custom) return custom;
  throw new Error("Provider has no models");
}

export function getFallbackModel(
  provider: string,
  explicitModel: boolean,
  providerChanged: boolean,
  customProviders?: Model<Api>[],
): Model<Api> {
  if (explicitModel) {
    throw new Error("Model not found");
  }

  if (!providerChanged) {
    throw new Error("Model not found");
  }

  return getFirstModelConfig(provider, customProviders);
}

export function getProviderModels(
  provider: string,
  customProviders?: Model<Api>[],
): Model<Api>[] {
  const builtIn = isBuiltinProvider(provider) ? getBuiltinModels(provider) : [];
  const custom = customProviders?.filter((m) => m.provider === provider) ?? [];

  return [...builtIn, ...custom];
}

export function createAppModels(customProviders?: Model<Api>[]) {
  const models = builtinModels({ credentials: createCredentialStore() });
  const customProviderGroups = new Map<string, Model<Api>[]>();

  for (const model of customProviders ?? []) {
    const group = customProviderGroups.get(model.provider) ?? [];
    group.push(model);
    customProviderGroups.set(model.provider, group);
  }

  for (const [provider, providerModels] of customProviderGroups) {
    models.setProvider(
      createProvider({
        id: provider,
        name: provider,
        models: providerModels,
        auth: {
          apiKey: {
            name: provider,
            resolve: async () => ({ auth: { apiKey: "dummy" } }),
          },
        },
        api: Object.fromEntries(
          Object.entries(API_STREAMS)
            .filter(([api]) =>
              providerModels.some((model) => model.api === api),
            )
            .map(([api, createStreams]) => [api, createStreams()]),
        ),
      }),
    );
  }

  return models;
}

export async function getConfiguredBuiltinProviders(): Promise<string[]> {
  const models = builtinModels({ credentials: createCredentialStore() });
  const providers: string[] = [];

  for (const provider of models.getProviders()) {
    const model = provider.getModels()[0];
    if (!model) continue;

    try {
      const auth = await models.getAuth(model);
      if (auth) providers.push(provider.id);
    } catch {}
  }

  return providers;
}
