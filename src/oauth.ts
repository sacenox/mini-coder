import { mkdir } from "node:fs/promises";
import readline from "node:readline";

import {
  getOAuthProvider,
  getOAuthProviders,
  type OAuthLoginCallbacks,
  type OAuthPrompt,
  type OAuthProviderId,
  type OAuthSelectPrompt,
} from "@earendil-works/pi-ai/oauth";
import {
  createAppModels,
  getConfiguredBuiltinProviders,
  isBuiltinProvider,
} from "./models.ts";
import { AUTH_PATH as AUTH_FILE } from "./shared";
import type { CliOptions, SavedOAuthCreds } from "./types";

type ReadlineInterface = ReturnType<typeof readline.createInterface>;

function ask(rl: ReadlineInterface, question: string): Promise<string> {
  return new Promise((resolve) => rl.question(question, resolve));
}

function formatPrompt(prompt: OAuthPrompt): string {
  const placeholder = prompt.placeholder ? ` (${prompt.placeholder})` : "";
  return `${prompt.message}${placeholder}: `;
}

async function selectOption(
  rl: ReadlineInterface,
  prompt: OAuthSelectPrompt,
): Promise<string | undefined> {
  console.log(prompt.message);
  for (let i = 0; i < prompt.options.length; i++) {
    console.log(`${i + 1}. ${prompt.options[i]?.label}`);
  }

  const choice = await ask(rl, `Enter number (1-${prompt.options.length}): `);
  const index = Number.parseInt(choice, 10) - 1;
  return prompt.options[index]?.id;
}

function createLoginCallbacks(rl: ReadlineInterface): OAuthLoginCallbacks {
  return {
    onAuth: ({ url, instructions }) => {
      console.log(`Open: ${url}`);
      if (instructions) console.log(instructions);
    },
    onDeviceCode: ({ userCode, verificationUri }) => {
      console.log(`Open: ${verificationUri}`);
      console.log(`Enter code: ${userCode}`);
    },
    onPrompt: (prompt) => ask(rl, formatPrompt(prompt)),
    onProgress: (message) => console.log(message),
    onSelect: (prompt) => selectOption(rl, prompt),
  };
}

export function isOAuthProvider(provider: string): boolean {
  return getOAuthProviders().some(
    (oauthProvider) => oauthProvider.id === provider,
  );
}

export async function getAvailableProviders(): Promise<string[]> {
  const auth = await readCreds();
  const loggedInOAuthProviders = getOAuthProviders()
    .map((provider) => provider.id)
    .filter((provider) => auth[provider]);
  const envKeyProviders = await getConfiguredBuiltinProviders();
  const providers: string[] = [];
  const providerIds = new Set<string>();

  for (const provider of [...loggedInOAuthProviders, ...envKeyProviders]) {
    if (providerIds.has(provider)) continue;

    providers.push(provider);
    providerIds.add(provider);
  }

  return providers;
}

export async function loginOAuth(provider: OAuthProviderId) {
  const oauthProvider = getOAuthProvider(provider);
  if (!oauthProvider) throw new Error(`Unknown OAuth provider: ${provider}`);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    const creds = await oauthProvider.login(createLoginCallbacks(rl));

    await writeCreds({ [provider]: { type: "oauth", ...creds } });
  } finally {
    rl.close();
  }

  return await readCreds();
}

export async function getApiKey(options: CliOptions) {
  const provider = options.model.provider;
  const models = createAppModels(options.customProviders);
  const auth = await models.getAuth(options.model);

  if (auth?.auth.apiKey) return auth.auth.apiKey;

  if (!isBuiltinProvider(provider)) {
    if (options.model.api === "openai-completions") {
      // pi-ai requires a truthy apiKey for OpenAI-compatible local providers like Ollama.
      return "dummy";
    }

    return undefined;
  }

  throw new Error("Not logged in");
}

export async function readCreds(): Promise<SavedOAuthCreds> {
  const file = Bun.file(AUTH_FILE);
  if (await file.exists()) {
    try {
      return JSON.parse(await file.text());
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Invalid auth JSON: ${message}`);
    }
  }

  return {};
}

async function writeCreds(creds: SavedOAuthCreds) {
  await mkdir(DATA_DIR, { recursive: true });
  await Bun.write(AUTH_FILE, JSON.stringify(await mergeCreds(creds)));
}

async function mergeCreds(newCreds: SavedOAuthCreds) {
  const oldCreds = await readCreds();
  return { ...oldCreds, ...newCreds };
}
