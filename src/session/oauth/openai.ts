/**
 * OpenAI Codex OAuth flow (ChatGPT Plus/Pro subscription).
 *
 * Uses Authorization Code + PKCE against auth.openai.com.
 * Starts a local HTTP callback server for the redirect.
 * Tokens are used against chatgpt.com/backend-api/codex (Responses API).
 */

import { createServer, type Server } from "node:http";
import { generatePKCE } from "./pkce.ts";
import type {
  OAuthCredentials,
  OAuthLoginCallbacks,
  OAuthProviderConfig,
} from "./types.ts";

const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const AUTHORIZE_URL = "https://auth.openai.com/oauth/authorize";
const TOKEN_URL = "https://auth.openai.com/oauth/token";
const CALLBACK_HOST = "127.0.0.1";
const CALLBACK_PORT = 1455;
const CALLBACK_PATH = "/auth/callback";
const REDIRECT_URI = `http://localhost:${CALLBACK_PORT}${CALLBACK_PATH}`;
const SCOPES = "openid profile email offline_access";

const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;

const SUCCESS_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Authenticated</title></head>
<body><p>OpenAI authentication successful. Return to your terminal.</p></body></html>`;

function createState(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let hex = "";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return hex;
}

function startCallbackServer(expectedState: string): Promise<{
  server: Server;
  waitForCode: () => Promise<{ code: string } | null>;
  cancel: () => void;
}> {
  return new Promise((resolve, reject) => {
    let result: { code: string } | null = null;
    let cancelled = false;

    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "", "http://localhost");
      if (url.pathname !== CALLBACK_PATH) {
        res.writeHead(404).end("Not found");
        return;
      }

      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      const error = url.searchParams.get("error");

      if (error || !code || !state || state !== expectedState) {
        res.writeHead(400).end("Authentication failed.");
        return;
      }

      res.writeHead(200, { "Content-Type": "text/html" }).end(SUCCESS_HTML);
      result = { code };
    });

    server.on("error", reject);
    server.listen(CALLBACK_PORT, CALLBACK_HOST, () => {
      resolve({
        server,
        cancel: () => {
          cancelled = true;
        },
        waitForCode: async () => {
          const deadline = Date.now() + LOGIN_TIMEOUT_MS;
          while (!result && !cancelled && Date.now() < deadline) {
            await new Promise((r) => setTimeout(r, 100));
          }
          return result;
        },
      });
    });
  });
}

async function postTokenRequest(
  body: URLSearchParams,
  label: string,
): Promise<OAuthCredentials> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${label} failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };

  return {
    access: data.access_token,
    refresh: data.refresh_token,
    // Expire 5 minutes early to avoid edge cases
    expires: Date.now() + data.expires_in * 1000 - 5 * 60 * 1000,
  };
}

function exchangeCode(
  code: string,
  verifier: string,
): Promise<OAuthCredentials> {
  return postTokenRequest(
    new URLSearchParams({
      grant_type: "authorization_code",
      client_id: CLIENT_ID,
      code,
      code_verifier: verifier,
      redirect_uri: REDIRECT_URI,
    }),
    "Token exchange",
  );
}

function refreshOpenAIToken(refreshToken: string): Promise<OAuthCredentials> {
  return postTokenRequest(
    new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: CLIENT_ID,
    }),
    "Token refresh",
  );
}

async function loginOpenAI(
  callbacks: OAuthLoginCallbacks,
): Promise<OAuthCredentials> {
  const { verifier, challenge } = await generatePKCE();
  const state = createState();
  const cb = await startCallbackServer(state);

  try {
    const params = new URLSearchParams({
      response_type: "code",
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      scope: SCOPES,
      code_challenge: challenge,
      code_challenge_method: "S256",
      state,
      id_token_add_organizations: "true",
      codex_cli_simplified_flow: "true",
      originator: "mc",
    });

    callbacks.onOpenUrl(
      `${AUTHORIZE_URL}?${params}`,
      "Complete login in your browser.",
    );

    const result = await cb.waitForCode();
    if (!result) throw new Error("Login cancelled or no code received");

    callbacks.onProgress("Exchanging authorization code for tokens…");
    return exchangeCode(result.code, verifier);
  } finally {
    cb.server.close();
  }
}

/**
 * Extract chatgpt_account_id from the OAuth JWT access token.
 * Returns null if the token is not a JWT or lacks the claim.
 */
export function extractAccountId(accessToken: string): string | null {
  try {
    const parts = accessToken.split(".");
    const jwt = parts[1];
    if (parts.length !== 3 || !jwt) return null;
    const payload = JSON.parse(atob(jwt)) as Record<string, unknown>;
    const auth = payload["https://api.openai.com/auth"] as
      | { chatgpt_account_id?: string }
      | undefined;
    return auth?.chatgpt_account_id ?? null;
  } catch {
    return null;
  }
}

export const openaiOAuth: OAuthProviderConfig = {
  id: "openai",
  name: "OpenAI (ChatGPT Plus/Pro)",
  login: loginOpenAI,
  refreshToken: refreshOpenAIToken,
};
