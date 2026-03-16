/**
 * Anthropic OAuth flow (Claude Pro/Max subscription).
 *
 * Uses Authorization Code + PKCE against claude.ai/platform.claude.com.
 * Starts a local HTTP callback server for the redirect.
 */

import { createServer, type Server } from "node:http";
import { generatePKCE } from "./pkce.ts";
import type {
	OAuthCredentials,
	OAuthLoginCallbacks,
	OAuthProviderConfig,
} from "./types.ts";

const CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const AUTHORIZE_URL = "https://claude.ai/oauth/authorize";
const TOKEN_URL = "https://platform.claude.com/v1/oauth/token";
const CALLBACK_HOST = "127.0.0.1";
const CALLBACK_PORT = 53692;
const CALLBACK_PATH = "/callback";
const REDIRECT_URI = `http://localhost:${CALLBACK_PORT}${CALLBACK_PATH}`;
const SCOPES =
	"org:create_api_key user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload";

const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;

const SUCCESS_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Authenticated</title></head>
<body><p>Authentication successful. Return to your terminal.</p></body></html>`;

function startCallbackServer(expectedState: string): Promise<{
	server: Server;
	waitForCode: () => Promise<{ code: string; state: string } | null>;
	cancel: () => void;
}> {
	return new Promise((resolve, reject) => {
		let result: { code: string; state: string } | null = null;
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
			result = { code, state };
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
	body: Record<string, string>,
	label: string,
): Promise<OAuthCredentials> {
	const res = await fetch(TOKEN_URL, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Accept: "application/json",
		},
		body: JSON.stringify(body),
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
	state: string,
	verifier: string,
): Promise<OAuthCredentials> {
	return postTokenRequest(
		{
			grant_type: "authorization_code",
			client_id: CLIENT_ID,
			code,
			state,
			redirect_uri: REDIRECT_URI,
			code_verifier: verifier,
		},
		"Token exchange",
	);
}

function refreshAnthropicToken(
	refreshToken: string,
): Promise<OAuthCredentials> {
	return postTokenRequest(
		{
			grant_type: "refresh_token",
			client_id: CLIENT_ID,
			refresh_token: refreshToken,
		},
		"Token refresh",
	);
}

async function loginAnthropic(
	callbacks: OAuthLoginCallbacks,
): Promise<OAuthCredentials> {
	const { verifier, challenge } = await generatePKCE();
	const cb = await startCallbackServer(verifier);

	try {
		const params = new URLSearchParams({
			code: "true",
			client_id: CLIENT_ID,
			response_type: "code",
			redirect_uri: REDIRECT_URI,
			scope: SCOPES,
			code_challenge: challenge,
			code_challenge_method: "S256",
			state: verifier,
		});

		callbacks.onOpenUrl(
			`${AUTHORIZE_URL}?${params}`,
			"Complete login in your browser.",
		);

		const result = await cb.waitForCode();
		if (!result) throw new Error("Login cancelled or no code received");

		callbacks.onProgress("Exchanging authorization code for tokens…");
		return exchangeCode(result.code, result.state, verifier);
	} finally {
		cb.server.close();
	}
}

export const anthropicOAuth: OAuthProviderConfig = {
	id: "anthropic",
	name: "Anthropic (Claude Pro/Max)",
	login: loginAnthropic,
	refreshToken: refreshAnthropicToken,
};
