# Anthropic OAuth Removal Design

## Goal

Remove Claude Code subscription OAuth support from mini-coder while preserving:

- direct Anthropic API key support via `ANTHROPIC_API_KEY`
- Anthropic-family models served through Opencode Zen (`zen/claude-*`)

## Approved behavior

- `anthropic` is removed completely from the user-facing OAuth surface.
- `/login anthropic` is no longer supported and behaves like any unknown provider.
- `/logout anthropic` is no longer documented or advertised as a supported path.
- Existing saved Anthropic OAuth rows in SQLite are ignored; no migration or cleanup is required.
- Anthropic remains available through `ANTHROPIC_API_KEY`.
- Zen-backed Claude models remain available and unchanged.

## Approach

Use a narrow OAuth-only removal:

1. Remove the Anthropic OAuth provider module and provider registration.
2. Stop consulting Anthropic OAuth state during provider discovery and model-info refresh visibility.
3. Keep direct Anthropic provider resolution via `ANTHROPIC_API_KEY`.
4. Keep Anthropic-family request handling and Zen backend routing unchanged.
5. Update tests and docs to match the new OAuth surface.

## Files in scope

- `src/session/oauth/anthropic.ts` — delete
- `src/session/oauth/auth-storage.ts` — unregister Anthropic OAuth
- `src/llm-api/providers.ts` — stop treating Anthropic OAuth as connected
- `src/llm-api/model-info.ts` — stop treating Anthropic OAuth as a refresh/visibility source
- `src/llm-api/model-info-fetch.ts` — stop fetching Anthropic models via OAuth tokens
- `src/cli/commands-help.ts` — remove Anthropic OAuth example text
- `docs/mini-coder.1.md` — document OpenAI-only OAuth support
- tests around provider discovery/model info — update to be deterministic and Anthropic-OAuth-free

## Risks and mitigations

- Risk: accidentally breaking direct Anthropic API-key support.
  - Mitigation: keep direct provider resolver and add/update tests that verify `ANTHROPIC_API_KEY` still wins.
- Risk: accidentally breaking Zen Claude behavior.
  - Mitigation: avoid touching Anthropic-family routing/caching code used for Zen.
- Risk: stale Anthropic OAuth tokens still affecting behavior.
  - Mitigation: remove all Anthropic OAuth checks from discovery and model fetching paths.
