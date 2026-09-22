import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  createModels,
  createProvider,
  envApiKeyAuth,
  type Api,
  type Model,
  type MutableModels,
  type ThinkingLevel,
} from "@earendil-works/pi-ai";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import { anthropicMessagesApi } from "@earendil-works/pi-ai/api/anthropic-messages.lazy";
import { googleGenerativeAIApi } from "@earendil-works/pi-ai/api/google-generative-ai.lazy";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { openAIResponsesApi } from "@earendil-works/pi-ai/api/openai-responses.lazy";

export const CUSTOM_APIS = [
  "openai-completions",
  "openai-responses",
  "anthropic-messages",
  "google-generative-ai",
] as const;
export type CustomApi = (typeof CUSTOM_APIS)[number];

export const TOOL_NAMES = ["edit", "bash"] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

export interface CustomProviderConfig {
  id: string;
  name?: string;
  baseUrl: string;
  api: CustomApi;
  models: string[];
  envKeys?: string[];
  headers?: Record<string, string>;
}

export interface Config {
  sessionsDir: string;
  systemPrompt: string;
  discoverAgentFiles: boolean;
  skillsDirs: string[];
  tools: ToolName[];
  provider: string;
  model: string;
  thinkingEffort: ThinkingLevel;
  customProviders: CustomProviderConfig[];
}

const THINKING_LEVELS: ThinkingLevel[] = [
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

export function configPath(): string {
  const base = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(base, "mini-coder", "config.json");
}

export function loadConfig(): Config {
  let raw: Record<string, unknown> = {};
  const path = configPath();
  try {
    raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw new Error(`config ${path}: ${(error as Error).message}`);
    }
  }

  const tools = raw.tools === undefined ? ["edit", "bash"] : raw.tools;
  if (!Array.isArray(tools) || tools.some((t) => !TOOL_NAMES.includes(t as ToolName))) {
    throw new Error(`config tools: expected a subset of ${TOOL_NAMES.join(", ")}`);
  }

  const thinkingEffort = raw.thinkingEffort ?? "medium";
  if (typeof thinkingEffort !== "string" || !THINKING_LEVELS.includes(thinkingEffort as ThinkingLevel)) {
    throw new Error(`config thinkingEffort: expected one of ${THINKING_LEVELS.join(", ")}`);
  }

  return {
    sessionsDir: str(raw, "sessionsDir", join(process.cwd(), "sessions")),
    systemPrompt: str(raw, "systemPrompt", ""),
    discoverAgentFiles: bool(raw, "discoverAgentFiles", true),
    skillsDirs: strArray(raw, "skillsDirs", []),
    tools: tools as ToolName[],
    provider: str(raw, "provider", "anthropic"),
    model: str(raw, "model", "claude-sonnet-4-5"),
    thinkingEffort: thinkingEffort as ThinkingLevel,
    customProviders: customProviders(raw.customProviders),
  };
}

function str(raw: Record<string, unknown>, field: string, fallback: string): string {
  const value = raw[field];
  if (value === undefined) return fallback;
  if (typeof value !== "string") throw new Error(`config ${field}: expected a string`);
  return value;
}

function bool(raw: Record<string, unknown>, field: string, fallback: boolean): boolean {
  const value = raw[field];
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") throw new Error(`config ${field}: expected a boolean`);
  return value;
}

function strArray(raw: Record<string, unknown>, field: string, fallback: string[]): string[] {
  const value = raw[field];
  if (value === undefined) return fallback;
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) {
    throw new Error(`config ${field}: expected an array of strings`);
  }
  return value as string[];
}

function customProviders(value: unknown): CustomProviderConfig[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("config customProviders: expected an array");
  return value.map((entry, index) => {
    if (typeof entry !== "object" || entry === null) {
      throw new Error(`config customProviders[${index}]: expected an object`);
    }
    const provider = entry as Record<string, unknown>;
    const where = `config customProviders[${index}]`;
    const id = provider.id;
    if (typeof id !== "string" || id.length === 0) throw new Error(`${where}.id: expected a non-empty string`);
    const baseUrl = provider.baseUrl;
    if (typeof baseUrl !== "string" || baseUrl.length === 0) throw new Error(`${where}.baseUrl: expected a non-empty string`);
    const api = provider.api;
    if (typeof api !== "string" || !CUSTOM_APIS.includes(api as CustomApi)) {
      throw new Error(`${where}.api: expected one of ${CUSTOM_APIS.join(", ")}`);
    }
    const models = provider.models;
    if (!Array.isArray(models) || models.length === 0 || models.some((m) => typeof m !== "string")) {
      throw new Error(`${where}.models: expected a non-empty array of strings`);
    }
    return {
      id,
      name: typeof provider.name === "string" ? provider.name : undefined,
      baseUrl,
      api: api as CustomApi,
      models: models as string[],
      envKeys: strArray(provider, "envKeys", []),
      headers: headers(provider.headers, `${where}.headers`),
    };
  });
}

function headers(value: unknown, where: string): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "object" || value === null) throw new Error(`${where}: expected an object`);
  const out: Record<string, string> = {};
  for (const [key, val] of Object.entries(value)) {
    if (typeof val !== "string") throw new Error(`${where}.${key}: expected a string`);
    out[key] = val;
  }
  return out;
}

const API_FACTORY: Record<CustomApi, () => ReturnType<typeof openAICompletionsApi>> = {
  "openai-completions": openAICompletionsApi,
  "openai-responses": openAIResponsesApi,
  "anthropic-messages": anthropicMessagesApi,
  "google-generative-ai": googleGenerativeAIApi,
};

export interface ResolvedModel {
  models: MutableModels;
  model: Model<Api>;
}

export function resolveModel(config: Config): ResolvedModel {
  const models = builtinModels();
  for (const provider of config.customProviders) {
    models.setProvider(
      createProvider({
        id: provider.id,
        name: provider.name ?? provider.id,
        baseUrl: provider.baseUrl,
        headers: provider.headers,
        auth: {
          apiKey: provider.envKeys?.length
            ? envApiKeyAuth(provider.name ?? provider.id, provider.envKeys)
            : { name: provider.name ?? provider.id, resolve: async () => ({ auth: { apiKey: "unused" } }) },
        },
        api: API_FACTORY[provider.api](),
        models: provider.models.map((id) => ({
          id,
          name: id,
          api: provider.api,
          provider: provider.id,
          baseUrl: provider.baseUrl,
          reasoning: false,
          input: ["text"] as ("text" | "image")[],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 200_000,
          maxTokens: 32_768,
        })),
      }),
    );
  }

  const model = models.getModel(config.provider, config.model);
  if (!model) {
    const known = models
      .getModels(config.provider)
      .map((m) => m.id)
      .slice(0, 12);
    const hint = known.length ? ` (available: ${known.join(", ")})` : "";
    throw new Error(`config model: unknown model "${config.model}" for provider "${config.provider}"${hint}`);
  }
  return { models, model };
}
