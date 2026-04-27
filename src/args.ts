import { mkdir } from "node:fs/promises";
import {
  type Api,
  getModels,
  getProviders,
  type KnownProvider,
  type Model,
  type ThinkingLevel,
} from "@mariozechner/pi-ai";
import { loginOAuth } from "./oauth";
import { DATA_DIR, SETTINGS_PATH } from "./shared.ts";
import type { CliOptions, Settings } from "./types.ts";

const DEFAULT_PROVIDER: KnownProvider = "openai-codex";
const DEFAULT_MODEL_ID = "gpt-5.5";
const DEFAULT_EFFORT: ThinkingLevel = "xhigh";
const VALID_EFFORTS: ThinkingLevel[] = [
  "low",
  "medium",
  "minimal",
  "high",
  "xhigh",
];

async function getSettings(): Promise<Settings | undefined> {
  const file = Bun.file(SETTINGS_PATH);

  if (!(await file.exists())) {
    return;
  }

  const jsonText = await file.text();
  const settings: Settings = JSON.parse(jsonText);

  return settings;
}

async function saveSettings(s: Settings) {
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

function getKnownProvider(provider: string): KnownProvider {
  const providers = getProviders();
  const knownProvider = providers.find((p) => p === provider);

  if (!knownProvider) {
    throw new Error(`Unknown provider: ${provider}`);
  }

  return knownProvider;
}

function getThinkingLevel(effort: string): ThinkingLevel {
  const thinkingLevel = VALID_EFFORTS.find((level) => level === effort);

  if (!thinkingLevel) {
    throw new Error(`Invalid effort: ${effort}`);
  }

  return thinkingLevel;
}

function findModelConfig(modelId: string, provider: KnownProvider) {
  const models = getModels(provider);
  if (models.length === 0) throw new Error("Provider has no models");

  return models.find((m) => m.id === modelId);
}

function getFirstModelConfig(provider: KnownProvider): Model<Api> {
  const model = getModels(provider)[0];
  if (!model) throw new Error("Provider has no models");

  return model;
}

function getFallbackModel(
  provider: KnownProvider,
  explicitModel: boolean,
  providerChanged: boolean,
): Model<Api> {
  if (explicitModel) {
    throw new Error("Model not found");
  }

  if (!providerChanged) {
    throw new Error("Model not found");
  }

  return getFirstModelConfig(provider);
}

export async function handleArgv(argv: string[]): Promise<CliOptions> {
  const settings = await getSettings();
  const settingsProvider = settings?.provider ?? DEFAULT_PROVIDER;
  const settingsModelId = settings?.model ?? DEFAULT_MODEL_ID;
  const settingsEffort = settings?.effort ?? DEFAULT_EFFORT;
  let provider = settingsProvider;
  let modelId = settingsModelId;
  let effort = settingsEffort;
  let prompt: string | undefined;
  let providerChanged = false;
  let explicitModel = false;

  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];

    // Settings
    if (flag === "--provider") {
      provider = getKnownProvider(requireValue(argv, i, flag));
      providerChanged = provider !== settingsProvider;
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
      effort = getThinkingLevel(requireValue(argv, i, flag));
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
      i++;
    }
  }

  const selectedModel = findModelConfig(modelId, provider);
  const model =
    selectedModel ?? getFallbackModel(provider, explicitModel, providerChanged);

  const options: CliOptions = {
    provider,
    model,
    effort,
    prompt,
  };
  const nextSettings: Settings = {
    provider,
    model: model.id,
    effort,
  };

  await saveSettings(nextSettings);
  return options;
}
