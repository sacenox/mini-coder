import { mkdir } from "node:fs/promises";
import {
  type Api,
  getModels,
  getProviders,
  type Model,
  type ThinkingLevel,
} from "@mariozechner/pi-ai";
import { Value } from "typebox/value";
import { getAvailableProviders, isOAuthProvider, loginOAuth } from "./oauth";
import { DATA_DIR, SETTINGS_PATH } from "./shared.ts";
import {
  type CliOptions,
  CliOptionsSchema,
  type Settings,
  SettingsSchema,
} from "./types.ts";

const DEFAULT_PROVIDER = "openai-codex";
const DEFAULT_MODEL_ID = "gpt-5.5";
const DEFAULT_EFFORT: ThinkingLevel = "xhigh";

function formatValidationError(
  label: string,
  error: ReturnType<typeof Value.Errors>[number] | undefined,
) {
  if (!error) {
    return `Invalid ${label}`;
  }

  const path = error.instancePath || "/";
  return `Invalid ${label}: ${path} ${error.message}`;
}

function parseSettings(value: unknown, label: string): Settings {
  if (Value.Check(SettingsSchema, value)) {
    return value;
  }

  throw new Error(
    formatValidationError(label, Value.Errors(SettingsSchema, value)[0]),
  );
}

function parseCliOptions(value: unknown): CliOptions {
  if (Value.Check(CliOptionsSchema, value)) {
    return value;
  }

  throw new Error(
    formatValidationError(
      "CLI options",
      Value.Errors(CliOptionsSchema, value)[0],
    ),
  );
}

async function getSettings(): Promise<Settings | undefined> {
  const file = Bun.file(SETTINGS_PATH);

  if (!(await file.exists())) {
    return;
  }

  const jsonText = await file.text();
  const settings = JSON.parse(jsonText) as unknown;

  return parseSettings(settings, "settings");
}

export async function saveSettings(s: Settings) {
  await mkdir(DATA_DIR, { recursive: true });
  const file = Bun.file(SETTINGS_PATH);
  await Bun.write(file, JSON.stringify(s, null, 4));
}

function requireValue(argv: string[], index: number, flag: string) {
  const value = argv[index + 1];

  if (!value || value.startsWith("-")) {
    throw new Error(`${flag} requires a value`);
  }

  return value;
}

function findModelConfig(
  modelId: string,
  provider: string,
  customProviders?: Model<Api>[],
) {
  const knownProviders = getProviders() as string[];
  if (knownProviders.includes(provider)) {
    const models = getModels(provider as any);
    if (models.length === 0) throw new Error("Provider has no models");
    return models.find((m) => m.id === modelId);
  }
  return customProviders?.find(
    (m) => m.provider === provider && m.id === modelId,
  );
}

function getFirstModelConfig(
  provider: string,
  customProviders?: Model<Api>[],
): Model<Api> {
  const knownProviders = getProviders() as string[];
  if (knownProviders.includes(provider)) {
    const models = getModels(provider as any);
    if (models.length > 0) return models[0];
  }
  const custom = customProviders?.find((m) => m.provider === provider);
  if (custom) return custom;
  throw new Error("Provider has no models");
}

function getFallbackModel(
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

export async function handleArgv(argv: string[]): Promise<CliOptions> {
  const settings = await getSettings();
  const customProviders = settings?.customProviders ?? [];
  const builtInProviders = await getAvailableProviders();
  const availableProviders = [
    ...new Set([
      ...builtInProviders,
      ...customProviders.map((cp) => cp.provider),
    ]),
  ];
  const defaultProvider = availableProviders[0] ?? DEFAULT_PROVIDER;
  const settingsProvider = settings?.provider ?? defaultProvider;
  const settingsModelId =
    settings?.model ??
    (settingsProvider === DEFAULT_PROVIDER
      ? DEFAULT_MODEL_ID
      : getFirstModelConfig(settingsProvider, customProviders).id);
  const settingsEffort = settings?.effort ?? DEFAULT_EFFORT;
  let provider: string = settingsProvider;
  let modelId = settingsModelId;
  let effort: string = settingsEffort;
  let prompt: string | undefined;
  let providerChanged = false;
  let explicitProvider = false;
  let explicitModel = false;

  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];

    // Settings
    if (flag === "--provider") {
      provider = parseSettings(
        {
          provider: requireValue(argv, i, flag),
          model: modelId,
          effort,
        },
        "CLI settings",
      ).provider;
      providerChanged = provider !== settingsProvider;
      explicitProvider = true;
      i++;
      continue;
    }

    if (flag === "--model") {
      modelId = requireValue(argv, i, flag);
      explicitModel = true;
      i++;
      continue;
    }

    if (flag === "--effort") {
      effort = parseSettings(
        {
          provider,
          model: modelId,
          effort: requireValue(argv, i, flag),
        },
        "CLI settings",
      ).effort;
      i++;
      continue;
    }

    // headless api
    if (flag === "--prompt" || flag === "-p") {
      prompt = requireValue(argv, i, flag);
      i++;
      continue;
    }

    if (flag === "--login" || flag === "-l") {
      await loginOAuth(requireValue(argv, i, flag));
      // Rebuild available providers after login
      const refreshedProviders = await getAvailableProviders();
      availableProviders.splice(
        0,
        availableProviders.length,
        ...new Set([
          ...refreshedProviders,
          ...customProviders.map((cp) => cp.provider),
        ]),
      );
      i++;
    }
  }

  let cliSettings = parseSettings(
    {
      provider,
      model: modelId,
      effort,
    },
    "CLI settings",
  );
  const providerAvailable = availableProviders.includes(cliSettings.provider);

  if (explicitProvider) {
    if (!providerAvailable && !isOAuthProvider(cliSettings.provider)) {
      throw new Error(
        `Provider "${cliSettings.provider}" is not logged in and no API key was found`,
      );
    }
  } else if (!providerAvailable && availableProviders.length) {
    const fallbackProvider = availableProviders[0];
    provider = fallbackProvider;
    providerChanged = provider !== settingsProvider;
    if (!explicitModel) {
      modelId = getFirstModelConfig(fallbackProvider, customProviders).id;
    }

    cliSettings = parseSettings(
      {
        provider,
        model: modelId,
        effort,
      },
      "CLI settings",
    );
  }

  const selectedModel = findModelConfig(
    cliSettings.model,
    cliSettings.provider,
    customProviders,
  );
  const model =
    selectedModel ??
    getFallbackModel(
      cliSettings.provider,
      explicitModel,
      providerChanged,
      customProviders,
    );

  const options = parseCliOptions({
    provider: cliSettings.provider,
    model,
    effort: cliSettings.effort,
    prompt,
    customProviders,
  });
  const nextSettings = parseSettings(
    {
      provider: options.provider,
      model: options.model.id,
      effort: options.effort,
      customProviders,
    },
    "settings",
  );

  await saveSettings(nextSettings);
  return options;
}
