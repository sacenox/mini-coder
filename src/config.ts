import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
  createProvider,
  envApiKeyAuth,
  Type,
  type Api,
  type Model,
  type MutableModels,
  type Static,
} from "@earendil-works/pi-ai";
import { Value } from "typebox/value";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import { anthropicMessagesApi } from "@earendil-works/pi-ai/api/anthropic-messages.lazy";
import { googleGenerativeAIApi } from "@earendil-works/pi-ai/api/google-generative-ai.lazy";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { openAIResponsesApi } from "@earendil-works/pi-ai/api/openai-responses.lazy";
import { createCredentialStore } from "./auth.ts";

const ToolNameSchema = Type.Union([Type.Literal("edit"), Type.Literal("read"), Type.Literal("bash")]);
export type ToolName = Static<typeof ToolNameSchema>;

const CustomApiSchema = Type.Union([
  Type.Literal("openai-completions"),
  Type.Literal("openai-responses"),
  Type.Literal("anthropic-messages"),
  Type.Literal("google-generative-ai"),
]);
type CustomApi = Static<typeof CustomApiSchema>;

const CustomProviderSchema = Type.Object(
  {
    id: Type.String({ minLength: 1 }),
    name: Type.Optional(Type.String()),
    baseUrl: Type.String({ minLength: 1 }),
    api: CustomApiSchema,
    models: Type.Array(Type.String(), { minItems: 1 }),
    envKeys: Type.Optional(Type.Array(Type.String())),
    headers: Type.Optional(Type.Record(Type.String(), Type.String())),
  },
  { additionalProperties: false },
);

const ConfigSchema = Type.Object(
  {
    sessionsDir: Type.String({ default: join(process.cwd(), "sessions") }),
    authFile: Type.String({ default: join(configDir(), "auth.json") }),
    systemPrompt: Type.String({ default: "" }),
    discoverAgentFiles: Type.Boolean({ default: true }),
    skillsDirs: Type.Array(Type.String(), { default: [] }),
    tools: Type.Array(ToolNameSchema, { default: ["edit", "read", "bash"] }),
    provider: Type.String(),
    model: Type.String(),
    thinkingEffort: Type.Union(
      [
        Type.Literal("minimal"),
        Type.Literal("low"),
        Type.Literal("medium"),
        Type.Literal("high"),
        Type.Literal("xhigh"),
        Type.Literal("max"),
      ],
      { default: "medium" },
    ),
    customProviders: Type.Array(CustomProviderSchema, { default: [] }),
  },
  { additionalProperties: false },
);
export type Config = Static<typeof ConfigSchema>;

function configDir(): string {
  const base = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(base, "mini-coder");
}

function configPath(): string {
  return join(configDir(), "config.json");
}

function readJson(path: string): unknown {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw new Error(`config ${path}: ${(error as Error).message}`);
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`config ${path}: ${(error as Error).message}`);
  }
}

export function loadConfig(): Config {
  const path = configPath();
  const filled = Value.Default(ConfigSchema, readJson(path));
  try {
    return Value.Parse(ConfigSchema, filled);
  } catch {
    const first = [...Value.Errors(ConfigSchema, filled)][0];
    throw new Error(`config ${path}: ${first ? `${first.instancePath || "/"} ${first.message}` : "invalid"}`);
  }
}

/**
 * Persist the chosen pair to the global config, leaving every other key
 * untouched. Written atomically: a temp file, then a rename over the target.
 */
export function saveSelection(provider: string, model: string): void {
  const path = configPath();
  const existing = readJson(path);
  if (typeof existing !== "object" || existing === null || Array.isArray(existing)) {
    throw new Error(`config ${path}: not an object`);
  }
  const next = { ...existing, provider, model };
  mkdirSync(dirname(path), { recursive: true });
  const temp = join(dirname(path), `.${process.pid}.${Date.now()}.tmp`);
  writeFileSync(temp, `${JSON.stringify(next, null, 2)}\n`);
  renameSync(temp, path);
}

const API_FACTORY: Record<CustomApi, () => ReturnType<typeof openAICompletionsApi>> = {
  "openai-completions": openAICompletionsApi,
  "openai-responses": openAIResponsesApi,
  "anthropic-messages": anthropicMessagesApi,
  "google-generative-ai": googleGenerativeAIApi,
};

export function resolveModel(config: Config): { models: MutableModels; model: Model<Api> } {
  const models = builtinModels({ credentials: createCredentialStore(config.authFile) });
  for (const provider of config.customProviders) {
    const name = provider.name ?? provider.id;
    models.setProvider(
      createProvider({
        id: provider.id,
        name,
        baseUrl: provider.baseUrl,
        headers: provider.headers,
        auth: {
          apiKey: provider.envKeys?.length
            ? envApiKeyAuth(name, provider.envKeys)
            : { name, resolve: async () => ({ auth: { apiKey: "unused" } }) },
        },
        api: API_FACTORY[provider.api](),
        models: provider.models.map((id) => ({
          id,
          name: id,
          api: provider.api,
          provider: provider.id,
          baseUrl: provider.baseUrl,
          reasoning: false,
          input: ["text"] satisfies ("text" | "image")[],
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
