# Models info refactor plan

## Why this change

Current model metadata is hardcoded in `src/llm-api/providers.ts`:

- `CONTEXT_WINDOW_TABLE` (regex-based, out of date)
- `REASONING_MODELS` (regex-based capability detection)

This causes drift and provider-dependent mismatches for the same underlying model.

We should move to a runtime-generated, cached model metadata layer using:

- provider model lists (what is actually available to this user)
- `https://models.dev/api.json` (capability source of truth)

## Facts from models.dev (verified)

- Top-level shape: object keyed by provider; each provider has `models` map.
- Model context limit is at `model.limit.context`.
- Reasoning support is at `model.reasoning` (currently boolean across all entries).
- `gpt-5.2` and `gpt-5.3-codex` entries show `limit.context = 400000`.

## Goals

1. Remove hardcoded context/reasoning capability tables.
2. Stop provider-specific regex matching for model capability lookup.
3. Build a canonical model capability cache in SQLite.
4. Refresh from network at app start (configured providers + models.dev).
5. Cache lifetime: at least 7 days (stale data still usable if refresh fails).
6. Keep runtime lookups fast and synchronous (`getContextWindow`, `supportsThinking`).

## Non-goals (for this pass)

- Rewriting provider transport/routing (`resolveModel`) behavior.
- Perfect aliasing for every third-party model name variant on day 1.
- Removing provider-specific payload encoding for thinking options (protocol shape still differs by provider).

## Design

### 1) New model metadata service

Create `src/llm-api/model-info.ts` as the single entrypoint for model capabilities.

Responsibilities:

- load cached metadata from DB into in-memory maps (startup)
- refresh cache from remote sources (startup background task)
- expose sync lookups used by hot paths:
  - `getContextWindow(modelString): number | null`
  - `supportsThinking(modelString): boolean`
  - `resolveModelInfo(modelString): ModelInfo | null`

### 2) DB schema additions (no destructive migration)

**Important:** current DB version mismatch wipes DB, so do **not** bump `DB_VERSION` for this change.
Add tables via `CREATE TABLE IF NOT EXISTS` in existing `SCHEMA`.

Proposed tables:

- `model_capabilities`
  - `canonical_model_id TEXT PRIMARY KEY`
  - `context_window INTEGER`
  - `reasoning INTEGER NOT NULL` (0/1)
  - `source_provider TEXT` (models.dev provider key)
  - `raw_json TEXT` (optional, for forward compatibility)
  - `updated_at INTEGER NOT NULL`

- `provider_models`
  - `provider TEXT NOT NULL`
  - `provider_model_id TEXT NOT NULL`
  - `display_name TEXT NOT NULL`
  - `canonical_model_id TEXT` (nullable if unmatched)
  - `context_window INTEGER` (provider-advertised fallback)
  - `free INTEGER` (0/1, optional)
  - `updated_at INTEGER NOT NULL`
  - `PRIMARY KEY (provider, provider_model_id)`

- `model_info_state`
  - `key TEXT PRIMARY KEY`
  - `value TEXT NOT NULL`
  - (or reuse `settings` with namespaced keys)

Store `last_models_dev_sync_at` and per-provider sync timestamps.

### 3) Remote fetchers

At app start, for configured providers, fetch provider model lists:

- `zen`: `GET /zen/v1/models`
- `openai`: `GET /v1/models`
- `anthropic`: `GET /v1/models`
- `google`: `GET /v1beta/models` (normalize `models/<id>`)
- `ollama`: `GET /api/tags` (local-only, likely unmatched in models.dev)

Fetch models.dev once:

- `GET https://models.dev/api.json`

Use short timeouts + fail-soft behavior.

### 4) Cross-match algorithm (provider-independent capabilities)

For each provider model entry:

1. Normalize candidate IDs (lowercase, trim, remove known wrappers like `models/`).
2. Exact match against models.dev `model.id` index.
3. If no exact match, try deterministic alias candidates (e.g. basename after `/`) **only when unique**.
4. If ambiguous/unmatched, leave `canonical_model_id = NULL` and keep provider fallback context.

Capability resolution order for runtime lookups:

1. `provider_models(provider, provider_model_id) -> canonical_model_id`
2. `model_capabilities(canonical_model_id)`
3. fallback: provider-advertised context (if any)
4. else unknown (`null` context, `false` reasoning)

This removes regex heuristics and makes capabilities independent from access provider.

### 5) Startup behavior

In `src/index.ts` main startup flow:

- initialize model-info cache from DB synchronously
- kick off async refresh if stale (`> 7 days`) or missing
- do not block CLI startup on full refresh; reuse cached snapshot immediately

Also let `/models` trigger a refresh when cache is stale and no refresh is in-flight.

### 6) Refactor existing call sites

- Move `getContextWindow` and `supportsThinking` out of regex tables in `providers.ts`.
- `providers.ts` should call model-info service for capability lookups.
- `fetchAvailableModels()` should read merged `provider_models` cache (and include current freshness status).

### 7) Reasoning params handling

models.dev currently gives `reasoning` capability (boolean), not effort enum/schema.

Plan:

- Use models.dev `reasoning` to decide whether thinking is supported.
- Keep provider-specific request-shape encoding in `getThinkingProviderOptions`.
- Remove model-family regex capability gates; rely on cached capability.
- Where per-model effort limits are unknown, clamp conservatively and fail-soft on provider rejection.

(If models.dev later adds richer reasoning schema, we can read it from `raw_json` without schema rewrite.)

## Testing plan (minimal, targeted)

Add tests for:

1. models.dev parser/indexing (`limit.context`, `reasoning`).
2. matching logic:
   - exact match
   - unique alias fallback
   - ambiguous alias -> no match
3. TTL logic (fresh vs stale > 7 days).
4. runtime lookup behavior from cached DB rows.
5. regression: same model via different providers resolves to same capabilities.

## Rollout checklist

1. Add DB tables + repo accessors.
2. Implement `model-info.ts` cache + refresh pipeline.
3. Wire startup init/refresh.
4. Replace hardcoded tables in `providers.ts`.
5. Update `/models` listing to use cached provider-model rows.
6. Run full checks:
   - `bun run typecheck && bun run format && bun run lint && bun test`

## Acceptance criteria

- No `CONTEXT_WINDOW_TABLE` or `REASONING_MODELS` hardcoded regex tables remain.
- `gpt-5.2`/`gpt-5.3*` context reflects 400k when matched from models.dev.
- Same model reached via different providers shows same context/reasoning capability.
- Metadata survives restarts and refreshes at most weekly (unless manually forced).
- App remains usable offline with last good cache.
