import readline from "node:readline";

import { getEnvApiKey, getProviders } from "@mariozechner/pi-ai";
import {
  getOAuthApiKey,
  getOAuthProvider,
  getOAuthProviders,
  type OAuthProviderId,
} from "@mariozechner/pi-ai/oauth";
import { AUTH_PATH as AUTH_FILE } from "./shared";
import type { CliOptions, SavedOAuthCreds } from "./types";

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
  const envKeyProviders = getProviders().filter(
    (provider) => !!getEnvApiKey(provider),
  );
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
    const creds = await oauthProvider.login({
      onAuth: ({ url, instructions }) => {
        console.log(`Open: ${url}`);
        if (instructions) console.log(instructions);
      },
      onPrompt: async (prompt) => {
        let answer: string = "";
        await rl.question(prompt.message, (a) => (answer = a));
        return answer;
      },
      onProgress: (message) => console.log(message),
    });

    await writeCreds({ [provider]: { type: "oauth", ...creds } });
  } finally {
    rl.close();
  }

  return await readCreds();
}

export async function getApiKey(options: CliOptions) {
  const provider = options.model.provider;
  const auth = await readCreds();

  if (isOAuthProvider(provider)) {
    const result = await getOAuthApiKey(provider, auth);
    if (result) {
      auth[provider] = { type: "oauth", ...result.newCredentials };
      await writeCreds(auth);

      return result.apiKey;
    }
  }

  const envApiKey = getEnvApiKey(provider);
  if (envApiKey) return envApiKey;

  const knownProviders = getProviders() as string[];
  if (!knownProviders.includes(provider)) {
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
    return JSON.parse(await file.text());
  }

  return {};
}

async function writeCreds(creds: SavedOAuthCreds) {
  await Bun.write(AUTH_FILE, JSON.stringify(await mergeCreds(creds)));
}

async function mergeCreds(newCreds: SavedOAuthCreds) {
  const oldCreds = await readCreds();
  return { ...oldCreds, ...newCreds };
}
