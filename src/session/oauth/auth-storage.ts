/**
 * SQLite-backed OAuth token storage.
 *
 * Tokens are stored in the oauth_tokens table and auto-refreshed when expired.
 */

import { getDb } from "../db/connection.ts";
import { anthropicOAuth } from "./anthropic.ts";
import type {
  OAuthCredentials,
  OAuthLoginCallbacks,
  OAuthProviderConfig,
} from "./types.ts";

interface OAuthTokenRow {
  provider: string;
  access_token: string;
  refresh_token: string;
  expires_at: number;
  updated_at: number;
}

const PROVIDERS: ReadonlyMap<string, OAuthProviderConfig> = new Map([
  [anthropicOAuth.id, anthropicOAuth],
]);

export function getOAuthProviders(): OAuthProviderConfig[] {
  return [...PROVIDERS.values()];
}

export function getOAuthProvider(id: string): OAuthProviderConfig | undefined {
  return PROVIDERS.get(id);
}

// ─── Persistence ──────────────────────────────────────────────────────────────

function getStoredToken(provider: string): OAuthTokenRow | null {
  return (
    getDb()
      .query<
        OAuthTokenRow,
        [string]
      >("SELECT provider, access_token, refresh_token, expires_at, updated_at FROM oauth_tokens WHERE provider = ?")
      .get(provider) ?? null
  );
}

function upsertToken(provider: string, creds: OAuthCredentials): void {
  getDb().run(
    `INSERT INTO oauth_tokens (provider, access_token, refresh_token, expires_at, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(provider) DO UPDATE SET
       access_token  = excluded.access_token,
       refresh_token = excluded.refresh_token,
       expires_at    = excluded.expires_at,
       updated_at    = excluded.updated_at`,
    [provider, creds.access, creds.refresh, creds.expires, Date.now()],
  );
}

function deleteToken(provider: string): void {
  getDb().run("DELETE FROM oauth_tokens WHERE provider = ?", [provider]);
}

/** True for HTTP 401/403 — the refresh token is definitively rejected. */
function isAuthError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return /\b(401|403)\b/.test(err.message);
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function isLoggedIn(provider: string): boolean {
  return getStoredToken(provider) !== null;
}

export function listLoggedInProviders(): string[] {
  return getDb()
    .query<{ provider: string }, []>(
      "SELECT provider FROM oauth_tokens ORDER BY provider",
    )
    .all()
    .map((r) => r.provider);
}

export async function login(
  providerId: string,
  callbacks: OAuthLoginCallbacks,
): Promise<void> {
  const provider = PROVIDERS.get(providerId);
  if (!provider) throw new Error(`Unknown OAuth provider: ${providerId}`);

  const creds = await provider.login(callbacks);
  upsertToken(providerId, creds);
}

export function logout(providerId: string): void {
  deleteToken(providerId);
}

/**
 * Get a valid access token for the provider.
 * Automatically refreshes if expired. Returns null if not logged in.
 */
export async function getAccessToken(
  providerId: string,
): Promise<string | null> {
  const row = getStoredToken(providerId);
  if (!row) return null;

  // Token still valid
  if (Date.now() < row.expires_at) {
    return row.access_token;
  }

  // Attempt refresh
  const provider = PROVIDERS.get(providerId);
  if (!provider) return null;

  try {
    const refreshed = await provider.refreshToken(row.refresh_token);
    upsertToken(providerId, refreshed);
    return refreshed.access;
  } catch (err) {
    // Only clear tokens on definitive auth failures, not transient network errors
    if (isAuthError(err)) {
      deleteToken(providerId);
    }
    return null;
  }
}
