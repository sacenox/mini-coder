# ChatGPT/Codex subscription auth notes

mini-coder does **not** currently support logging in with a ChatGPT Plus/Pro/Codex subscription.

## Why

We looked at two implementations:

- OpenCode in `/tmp/opencode-src`
- official Codex in `/tmp/openai-codex/codex-rs`

Both rely on OpenAI **first-party/private** auth and backend APIs rather than a documented public developer API.

## What those implementations do

### Auth

They use OAuth-like flows against `https://auth.openai.com`, including:

- browser login with PKCE and a localhost callback server
- device-code / headless login
- refresh tokens via `POST /oauth/token`

Both also rely on a hardcoded first-party client id embedded in their source trees.

Examples:

- official Codex: `/tmp/openai-codex/codex-rs/core/src/auth.rs`
- OpenCode: `/tmp/opencode-src/packages/opencode/src/plugin/codex.ts`

### Runtime API

After login, requests are sent to ChatGPT backend endpoints such as:

- `https://chatgpt.com/backend-api/codex`
- `https://chatgpt.com/backend-api/codex/responses`

with headers like:

- `Authorization: Bearer <oauth access token>`
- `ChatGPT-Account-Id: <account id>`

Examples:

- official Codex: `/tmp/openai-codex/codex-rs/core/src/model_provider_info.rs`
- official Codex headers: `/tmp/openai-codex/codex-rs/backend-client/src/client.rs`
- OpenCode rewrite layer: `/tmp/opencode-src/packages/opencode/src/plugin/codex.ts`

## Why mini-coder is not adopting this

- It depends on undocumented/private auth endpoints.
- It depends on a hardcoded first-party client id.
- It depends on private ChatGPT backend routes.
- Browser login would require running a local callback server.
- Even the official Codex source does not expose a clean public API-based alternative here.

## Future stance

We may revisit support if OpenAI exposes a stable, documented path for:

- ChatGPT subscription login for third-party tools, or
- a public Codex/ChatGPT backend API intended for external clients

Until then, mini-coder only supports providers with clearer public integration paths.

## Note

If you want a supported hosted integration instead of ChatGPT subscription auth, mini-coder already supports OpenCode Zen via `OPENCODE_API_KEY`. See the existing `zen/<model>` provider path.