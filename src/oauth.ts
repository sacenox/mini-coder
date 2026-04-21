import readline from "node:readline";

import {
  getOAuthApiKey,
  loginOpenAICodex,
  type OAuthProviderId,
} from "@mariozechner/pi-ai/oauth";
import type { CliOptions, SavedOAuthCreds } from "./types";

const AUTH_FILE = "./.auth.json";

export async function loginOAuth(provider: OAuthProviderId) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  switch (provider) {
    // TODO: other providers :)
    case "openai-codex": {
      const creds = await loginOpenAICodex({
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

      await writeCreds({ "openai-codex": { type: "oauth", ...creds } });
      break;
    }
    default:
      throw new Error("Unknown provider");
  }

  const savedCreds = await readCreds();
  return savedCreds;
}

export async function getApiKey(options: CliOptions) {
  const auth = await readCreds();
  const result = await getOAuthApiKey(options.provider, auth);
  if (!result) throw new Error("Not logged in");

  auth[options.provider] = { type: "oauth", ...result.newCredentials };
  await writeCreds(auth);

  return result.apiKey;
}

export async function readCreds() {
  const file = Bun.file(AUTH_FILE);
  const creds: SavedOAuthCreds = JSON.parse(await file.text());

  return creds;
}

async function writeCreds(creds: SavedOAuthCreds) {
  await Bun.write(AUTH_FILE, JSON.stringify(await mergeCreds(creds)));
}

async function mergeCreds(newCreds: SavedOAuthCreds) {
  const oldCreds = await readCreds();
  return { ...oldCreds, ...newCreds };
}
