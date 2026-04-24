import {
  getModels,
  type KnownProvider,
  type ThinkingLevel,
} from "@mariozechner/pi-ai";
import { loginOAuth } from "./oauth";
import type { CliOptions } from "./types.ts";

function getModelConfig(modelName: string, provider: KnownProvider) {
  const models = getModels(provider);
  if (models.length === 0) throw new Error("Provider has no models");

  const model = models.find((m) => m.id === modelName);
  if (!model) throw new Error("Model not found");

  return model;
}

// TODO: For when the user set's thinking value.
// function _isThinkingLevel(value: string): value is ThinkingLevel {
//   const THINKING_LEVELS = ["low", "medium", "minimal", "high", "xhigh"]
//   return (THINKING_LEVELS as readkonly string[]).includes(value);
// }

export async function handleArgv(argv: string[]): Promise<CliOptions> {
  // TODO: Fetch defaults from settings file
  let options: CliOptions = {
    model: getModelConfig("gpt-5.5", "openai-codex"),
    effort: "xhigh" as ThinkingLevel,
  };

  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];

    if (flag === "--prompt" || flag === "-p") {
      options = { ...options, prompt: argv[i + 1] };
    }

    if (flag === "--login" || flag === "-l") {
      await loginOAuth(argv[i + 1]);
    }
  }

  return options;
}
