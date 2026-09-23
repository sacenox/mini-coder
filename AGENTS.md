# mini-coder

A fast, transparent, config-first terminal coding agent for one user at a time.

This file holds intent, direction, and guardrails — not a description of the
code. The source is the source of truth for behavior. If a fact can be learned
by reading the code, it does not belong here; keep this file short.

## Intent

- A small, auditable core with no hidden machinery.
- A minimal system prompt with no injected meta-guidance.
- Provider work delegated entirely to `pi-ai`.
- Durable, user-owned, readable session logs.
- An append-only TUI with a bounded live region and no full-screen buffer.
- Local models (Ollama / llama.cpp / vLLM) and hosted models treated as equals.

Prior art is reference, not template: `x.x.x-archive` (previous implementation),
`../awl/` (append-only live-region TUI), `../bough/` (layer boundaries), and
`../agent-ide/` (session durability, streaming). Extract ideas, do not port code.

## Direction

Deferred, not rejected. Do not build unless explicitly promoted:

- context compaction / summarization / masking;
- reading or resuming sessions (the JSONL log is write-only today);
- prompt templates; custom agents / subagents / delegation;
- an extension or plugin system; a settings TUI; overlay editors;
- custom OAuth or auth flows (use `pi-ai`'s provider auth);
- MCP, image generation, multi-agent orchestration;
- sandboxing, approval prompts, permission policies;
- tests and CI (standing rule: no tests unless asked);
- macOS/Windows support and cross-platform abstractions. Target Linux first.

## Guardrails

Hard constraints. Do not cross these without explicit direction:

- **Node.js directly.** No Bun, no Deno, no `Bun.*`, no Bun package scripts.
- **No TUI library or framework.** Render with direct `process.stdout` ANSI
  writes and plain strings.
- **`pi-ai` owns the provider layer.** All model requests, adapters, wire
  formats, streaming, auth, and usage go through `@earendil-works/pi-ai`. Never
  re-implement a provider protocol, and keep provider-specific continuation data
  intact.
- **Write original code.** Other coding agents are behavioral references only.
- **No sandbox or permission layer.** Tools run with the user's permissions;
  isolation is an environment concern (`nono`), not the agent's.
- **No loop limits.** No max turns, tool calls, token budgets, or agent-imposed
  timeouts. The user's ability to interrupt is the limit.
- **Config-first.** Every user-facing behavior that can vary comes from config
  with a sane default. Global config only — no project-local config, no
  config-override flags — and never duplicate `pi-ai`'s catalog or env vars.
- **Minimal context.** The model sees the configured system prompt plus
  explicitly opted-in resource files — never reminders, hidden blocks, or
  harness meta-text.
- **Never invent a parallel model.** Consume `pi-ai`'s `Message` and stream
  types directly.
- **The agent never imports the TUI.** Headless and TUI are two projections of
  the same agent events; the TUI owns no agent or provider semantics.

## Invariants

- Sessions are append-only JSONL, one `pi-ai` message per line, fsynced on
  write. Never rewrite or delete committed lines. A persistence failure stops
  the turn.
- The loop has no compaction, no retries, and no meta-messages between steps.
  Provider errors surface as-is, never masked or summarized.
- `edit`, `read`, and `bash` only. Tool arguments are untrusted and validated
  once at the boundary. `read` returns image blocks only for models that declare
  image input.
- Interruption: ESC politely pauses at the next step boundary; Ctrl+C cancels the
  turn (abort the request, kill the tool's process group, persist the aborted
  message); Ctrl+D exits on an empty draft. Completed side effects are never
  undone.
- Diagnostics are local only. No telemetry, no hidden stalls.

## Working agreement

- Trace the real data flow before designing; apply guards at the narrowest
  boundary.
- Keep the diff small. Do not opportunistically refactor or harden adjacent code.
- Prefer plain functions and objects; keep exports minimal; define helpers near
  their use.
- Validate untrusted input once at the boundary with Typebox, then keep internal
  code plain-typed.
- Ask before adding a dependency.
- Do not add tests unless explicitly asked; verify manually.
- Before finishing, review the diff against the direction and guardrails, remove
  anything that added scope, and report any requirement you could not satisfy.
