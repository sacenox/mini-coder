# AUDIT REPORT

## Summary

I audited the codebase against the core idea in `AGENTS.md`, checked `docs/KNOWN_ISSUES.md`, reviewed `TODO.md` to avoid duplicates, compared the docs (`README.md`, `docs/mini-coder.1.md`) with the implementation, and ran verification with `bun run check`, `bun run build`, and `bun run typecheck`.

For runtime probing, I switched to one-shot prompts as requested and exercised these provider paths with the same prompt asking for the current branch and one session-related file:

- `zen/claude-haiku-4-5`
- `zen/gemini-3-flash`
- `zen/gpt-5.4-nano`
- `zen/glm-5` (`@ai-sdk/openai-compatible` path)
- `anthropic/claude-sonnet-4-6`

I also probed `anthropic/claude-haiku-4-5-20251001`, which failed with a 400. The sqlite logs show the request sent adaptive thinking to a model that does not support it.

Overall: the module split is clean, the tool surface stays small, tests are healthy, and the provider-specific streaming code is complex for a real reason. The main gaps are UX alignment with the append-only design, a direct Anthropic thinking bug, and a few surprising product behaviors that make the CLI feel less minimal than the source-of-truth design.

## Code & Architecture

### What is aligned

- Module boundaries are good: `cli/`, `agent/`, `llm-api/`, `session/`, `tools/`, `mcp/` are clearly separated and tests mostly live beside logic.
- The built-in tool surface is still intentionally small.
- The `llm-api` layer contains most provider-specific complexity instead of leaking it everywhere else.
- Verification is strong for a CLI project: tests, typecheck, lint/check, and build all passed.

### Findings

1. **`/new` breaks the append-only terminal model**  
   The core idea says the UI is append-only and should not clear or redraw. `handleNew()` explicitly clears the screen and redraws the banner instead (`src/cli/commands.ts:40-45`). This is a direct idea mismatch, not just a style preference.

2. **Provider status is promised in the design but not actually rendered**  
   The source of truth says the banner should list discovered context plus provider status, and the status bar should show model and provider separately (`AGENTS.md:90-96`). `renderBanner()` only shows model, cwd, flags, context files, and skill count (`src/cli/output.ts:109-125`). `renderStatusBar()` prints the combined model string but not a distinct provider field (`src/cli/status-bar.ts:78-105`).

3. **Direct Anthropic Haiku fails with the default thinking configuration**  
   `getAnthropicThinkingOptions()` applies adaptive thinking to all non-Zen Anthropic models (`src/llm-api/provider-options.ts:40-63`). In practice, `anthropic/claude-haiku-4-5-20251001` fails with `400 invalid_request_error: adaptive thinking is not supported on this model`. This is a real correctness bug, not a docs issue.

4. **Claude/Zen one-shot output leaks raw AI SDK warnings into user-visible output**  
   In one-shot runs, `zen/claude-haiku-4-5` printed repeated AI SDK warnings to stderr and an AI SDK warning banner to stdout before the final answer. That breaks the “small, fast, shell-like” UX because provider internals leak straight into the terminal. The request path always sets `maxOutputTokens` (`src/llm-api/turn-request.ts:81-87`), and the Anthropic Zen path also adds thinking budgets (`src/llm-api/provider-options.ts:49-57`), which is enough to trigger noisy SDK warnings for this model.

5. **Startup mutates user config by auto-creating a global review skill**  
   `bootstrapGlobalDefaults()` writes `~/.agents/skills/review/SKILL.md` on startup if it is missing (`src/cli/bootstrap.ts:36-45`). This is documented, but it is still a surprising side effect for a tool whose philosophy is “stays out of the way”. It feels like unnecessary product behavior on the critical startup path.

6. **README overclaims generic OpenAI-compatible support**  
   `README.md` says mini-coder auto-discovers “any OpenAI-compatible endpoint” (`README.md:53-60`), but the implementation only exposes `zen`, `anthropic`, `openai`, `google`, and `ollama` as supported providers (`src/llm-api/providers.ts:16-22`). The code does use `@ai-sdk/openai-compatible`, but not as a generic user-configurable provider.

### KISS / DRY / YAGNI assessment

- **Mostly good:** the overall shape is simpler than many agent CLIs, and the small built-in tool set stays disciplined.
- **Complex but justified:** `src/llm-api/turn-execution.ts` is dense, but the complexity is concentrated around real provider stream inconsistencies.
- **Least-aligned areas:** startup review-skill bootstrapping and the `/new` screen clear both feel like product flourishes that cut against the minimal, append-only philosophy.

## UI/UX Alignment

### What I observed

- **Interactive smoke check:** the CLI banner and status bar are readable and fast, but `/new` clears the terminal and redraws the banner instead of appending. That is the clearest source-of-truth mismatch.
- **One-shot provider matrix:**
  - `zen/gemini-3-flash`: clean output, good fit for the philosophy.
  - `zen/gpt-5.4-nano`: clean output, concise.
  - `zen/glm-5`: clean output, concise.
  - `anthropic/claude-sonnet-4-6`: clean output.
  - `zen/claude-haiku-4-5`: completed, but emitted multiple raw AI SDK warnings and a warning banner before the answer.
  - `anthropic/claude-haiku-4-5-20251001`: failed with API 400 because of incompatible thinking options.

### Alignment vs core idea

- **Append-only log:** violated by `/new` screen clearing.
- **Banner provider status:** missing.
- **Status bar fields:** session, branch, thinking effort, tokens, and context are there; provider is not shown as its own field.
- **Shell-like compact output:** good on Gemini/OpenAI/OpenAI-compatible paths; degraded on Zen Claude because SDK warnings spill into user output.
- **“Stays out of the way” startup:** weakened by auto-writing the review skill to the user’s home directory.

## Recommendations

### Immediate bugs

1. **Fix Anthropic thinking compatibility by model family**  
   Do not send adaptive thinking to Anthropic models that reject it. Either disable thinking for those models or gate supported effort modes by model capability.

2. **Stop leaking SDK warnings into the CLI stream**  
   Suppress raw AI SDK warning output and surface only intentional mini-coder messages. If a warning matters, render it once in the app’s own format.

3. **Remove the `/new` terminal clear**  
   Reset session state, but keep the transcript append-only.

### Code changes

1. **Render provider status explicitly in the banner and status bar**  
   This should come from actual detected provider availability/login state, not just the selected model string.

2. **Move review-skill bootstrapping off the unconditional startup path**  
   Better options: create it lazily on first `/review`, or ship the default behavior without mutating `~/.agents` until the user opts in.

3. **Tighten docs to the implementation**  
   Especially the README claim about “any OpenAI-compatible endpoint”. Either implement a real generic provider path or narrow the wording.

### Polish items

1. **Make one-shot output more deterministic across providers**  
   The prompt asked for exactly two bullets; some providers stayed concise, some added extra leading text. Stronger response-shaping or output normalization may help if strict shell ergonomics matter.

2. **Keep the current `llm-api` complexity contained**  
   The streaming layer is justified, but it is the part most likely to accrete provider-specific branches. Guard it with focused tests as new providers/models are added.
