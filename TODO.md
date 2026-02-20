# `cwd` leaks into tool schemas

All file tools expose `cwd` in their Zod schema, so the LLM sees it as a callable parameter. It's always injected by `withCwdDefault()` and should be hidden from the model.

---

# Fix implementation error

1. The DB only saves text — agent.ts:412–429 strips tool parts before writing to SQLite. That's the right design for persistence, but coreHistory in memory is never trimmed.

- Refactor sessions table to include content, tool call pairs and everything we need to remake
the history on resume. This breaks the schema, this is ok, we generate a new one.
- Ensure we don't break message format expected by the sdks.

---

src/tools/subagent.ts -- It should not include a model choice 

---

# Undo needs to restore working directory

Besides undoing the conversation turn, it should restore some snapshot, using git?

---

Subagent needs visibity on the ui somehow... that accounts for multiple in parallel... Needs planning, maybe a tree view showing the subagent's tool calls before the output.

---

# Plan mode changes

- Allow read tools + mcp
- When plan mode is on, add a `<system-message>PLAN MODE ACTIVE -- READ ONLY</system-message>` suffix to the user messages.

---

# LLMs don't know their cwd?:

```
▶ create a readme file and introduce yourself
  ✎ create README.md
    ✖ EACCES: permission denied, mkdir '/root/src/mini-coder'
  ✎ create README.md
    ✖ EACCES: permission denied, mkdir '/home/sandbox'
  $ $ pwd
    ✔ 0
    │ /home/xonecas/src/mini-coder
  ✎ create README.md
```

---

Oauth Open AI support?

## How opencode Implements OpenAI (Codex) OAuth Login

The implementation is spread across several layers, all in `packages/opencode/src/plugin/codex.ts` as the core, wired together through a plugin/provider-auth system.

---

### Architecture Overview

```
UI (dialog-connect-provider.tsx)
    ↓ HTTP
Server routes (server/routes/provider.ts)
    ↓
ProviderAuth namespace (provider/auth.ts)
    ↓
Plugin system (plugin/index.ts)
    ↓
CodexAuthPlugin (plugin/codex.ts)   ← OAuth logic lives here
    ↓
Auth storage (auth/index.ts)        ← Persists tokens to auth.json
```

---

### 1. The Plugin: `plugin/codex.ts`

This is the heart of the OpenAI OAuth flow. It registers itself for the `"openai"` provider and exposes **two OAuth methods** plus a fallback API key method:

#### Method 1: **Browser-based (PKCE + redirect)**
```
label: "ChatGPT Pro/Plus (browser)"
type: "oauth", method: "auto"
```
- Spawns a local HTTP server on port `1455` (`http://localhost:1455/auth/callback`) as the OAuth redirect URI
- Generates a **PKCE** (`code_verifier` / `code_challenge`) pair using `crypto.subtle.digest("SHA-256")`
- Generates a CSRF `state` token
- Builds the authorization URL against `https://auth.openai.com/oauth/authorize` with:
  - `client_id: "app_EMoamEEZ73f0CkXaXp7hrann"`
  - `scope: "openid profile email offline_access"`
  - `code_challenge_method: "S256"`
  - `codex_cli_simplified_flow: "true"`, `originator: "opencode"`
- Returns `method: "auto"` — the UI opens the URL, then polls by awaiting the callback promise
- When the browser redirects back, the local server handles `/auth/callback`, validates `state` (CSRF check), then POSTs the code + PKCE verifier to `https://auth.openai.com/oauth/token` to exchange for tokens

#### Method 2: **Headless (Device Code flow)**
```
label: "ChatGPT Pro/Plus (headless)"
type: "oauth", method: "auto"
```
- POSTs to `https://auth.openai.com/api/accounts/deviceauth/usercode` to get a `device_auth_id` and `user_code`
- Returns `url: "https://auth.openai.com/codex/device"` and `instructions: "Enter code: <user_code>"`
- Polls `https://auth.openai.com/api/accounts/deviceauth/token` until approved, then exchanges the `authorization_code` (plus `code_verifier` returned by the server) at `https://auth.openai.com/oauth/token`

#### Method 3: **API Key (manual)**
```
label: "Manually enter API Key"
type: "api"
```

---

### 2. Token Handling

After a successful OAuth exchange, the plugin returns:
```ts
{ type: "success", refresh: "...", access: "...", expires: Date.now() + expires_in * 1000, accountId: "..." }
```

`accountId` is extracted from the **JWT `id_token`** claims, looking for `chatgpt_account_id` (used to set the `ChatGPT-Account-Id` header for org subscriptions).

The `auth.ts` `loader` hook intercepts every API call:
- If the **access token is expired**, it silently **refreshes** via `refresh_token` at `https://auth.openai.com/oauth/token`
- Strips the dummy `Authorization` header set by the AI SDK
- Injects `Authorization: Bearer <access_token>` and optionally `ChatGPT-Account-Id: <accountId>`
- **Rewrites the URL** for `/v1/responses` or `/chat/completions` requests to the Codex endpoint: `https://chatgpt.com/backend-api/codex/responses`

A special constant `OAUTH_DUMMY_KEY = "opencode-oauth-dummy-key"` is returned as `apiKey` to satisfy the AI SDK's requirement for an API key, while the real auth is handled in the custom `fetch` interceptor.

---

### 3. Storage: `auth/index.ts`

All tokens are persisted to `~/.opencode/auth.json` (mode `0o600`) as a discriminated union:
```ts
{ type: "oauth", refresh: "...", access: "...", expires: 1234567890, accountId?: "..." }
```

---

### 4. Server Routes: `server/routes/provider.ts`

Two HTTP endpoints (via Hono) expose the OAuth flow to the UI:

| Endpoint | Purpose |
|---|---|
| `POST /:providerID/oauth/authorize` | Calls `ProviderAuth.authorize()` → triggers the plugin's `authorize()` → returns `{ url, method, instructions }` |
| `POST /:providerID/oauth/callback` | Calls `ProviderAuth.callback()` → triggers the plugin's `callback(code?)` → persists tokens via `Auth.set()` |
| `GET /auth` | Lists all auth methods from all plugins |

---

### 5. `ProviderAuth` Coordinator: `provider/auth.ts`

Acts as the bridge between the server routes and plugins:
- `authorize()` — calls the plugin's `method.authorize()` and stores the pending `AuthOuathResult` in instance state
- `callback()` — retrieves the pending result, calls `result.callback(code?)`, then:
  - If result has `key` → saves `{ type: "api", key }` to `Auth`
  - If result has `refresh` → saves `{ type: "oauth", access, refresh, expires, accountId? }` to `Auth`

---

### 6. UI: `dialog-connect-provider.tsx`

The UI presents the method list and drives the flow:

```
Method selected → selectMethod(index)
  └─ if type === "oauth":
       → calls provider.oauth.authorize({ providerID, method: index })
       → stores authorization { url, method: "auto"|"code", instructions }
       └─ if method === "auto":  OAuthAutoView
              Opens URL via platform.openLink()
              Shows confirmation code from instructions (e.g. "Enter code: XXXX")
              Calls provider.oauth.callback({ providerID, method }) — awaits completion
          if method === "code":  OAuthCodeView
              Opens URL via platform.openLink()
              User pastes the code manually
              Calls provider.oauth.callback({ providerID, method, code })
```

---

### Key Constants (OpenAI-specific)
| Constant | Value |
|---|---|
| `CLIENT_ID` | `app_EMoamEEZ73f0CkXaXp7hrann` |
| `ISSUER` | `https://auth.openai.com` |
| `CODEX_API_ENDPOINT` | `https://chatgpt.com/backend-api/codex/responses` |
| `OAUTH_PORT` | `1455` |
| Scopes | `openid profile email offline_access` |
