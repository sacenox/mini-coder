# Audit Report — mini-coder v0.2.1

**Date:** 2026-03-21
**Auditor:** Claude Code (automated audit skill)

## Summary

**Phase 1** reviewed every module (`agent/`, `cli/`, `llm-api/`, `tools/`, `session/`, `mcp/`, `internal/`) against the core idea document. All checks pass (`bun run check` — formatting, types, lint, knip, jscpd, 307 tests). Code duplication is minimal (0.28%, 41 lines / 4 clones across 129 files).

**Phase 2** tested 5 model paths interactively via tmux:
| Model | SDK path | Result |
|---|---|---|
| `zen/claude-haiku-4-5` | `@ai-sdk/anthropic` | ✅ Clean multi-turn, reasoning display, tool calls |
| `zen/gemini-3-flash` | `@ai-sdk/google` | ✅ Working, parallel tool calls rendered inline |
| `zen/gpt-5.4-nano` | `@ai-sdk/openai` (responses) | ✅ Working, verbose reasoning, redundant tool calls (model behavior) |
| `zen/minimax-m2.5` | `@ai-sdk/openai-compatible` | ✅ Clean, concise tool use |
| `anthropic/claude-haiku-4-5` | Anthropic OAuth | ✅ Parallel tool calls, ESC interrupt works |

Also tested: one-shot mode (`bun run dev 'What is 2+2?'`) — clean output with no banner noise.

## Code & Architecture

### Correctness issues

1. **Status bar loses context tokens after ESC interrupt.** After pressing ESC to cancel a streaming response, the status bar shows `tok 12.9k/258` without the `ctx` field. The interrupt path in `processUserInput` catches the error and re-throws without updating `lastContextTokens`. The turn's partial token data is lost.

2. ~~**`/agent` command documented but not implemented.** The `mini-coder` skill SKILL.md documents `/agent [name]` ("Set or clear active custom agent") but no such command exists in `commands.ts`. The help output also omits it. Either the doc should be updated or the feature should be implemented.~~ Done

### KISS/DRY/YAGNI observations

3. **`turn-execution.ts` (402 lines) does a lot.** It contains: tool conversion (`toCoreTool`, `buildToolSet`), Anthropic tool caching (`annotateToolCaching`), turn state tracking (`createTurnStateTracker`), stream normalization (`StreamToolCallTracker`, `StreamTextPhaseTracker`), and stream-to-event mapping. These are logically distinct responsibilities. The file is manageable but is the second-largest non-test file and the most complex.

4. **`isOpenAIReasoningModelFamily` matches `gpt-5*` and `o*` prefixes.** The `o*` prefix is very broad — any future `ollama/`-like model ID starting with `o` routed through zen would match. Currently safe because `getZenBackend` only hits this via `openai` path, but the routing function's generality could surprise.

5. **`compactToolResultPayloads` iterates all messages every step.** It's called via `prepareStep` on every multi-step tool loop. Each call scans and potentially clones the entire message array. For long conversations with many tool results this could become a hot path. Not a bug, but worth noting for performance.

### Architecture alignment with core idea

- ✅ **Shell-first tool surface** — `shell`, `listSkills`, `readSkill`, MCP, and optional web tools. Small and focused.
- ✅ **Append-only scrolling log** — no redraws observed, output pushes the prompt down.
- ✅ **16 ANSI colors** — `yoctocolors` only, no RGB/256-color escapes.
- ✅ **Single system prompt across all providers** — no provider-specific branches in `buildSystemPrompt`.
- ✅ **AGENTS.md / CLAUDE.md autodiscovery** — both `.agents/` and `.claude/` conventions supported with conflict warnings.
- ✅ **Skills discovery** — local + global, recursive walk, frontmatter validation, proper naming rules.
- ✅ **Prompt caching** — Anthropic cache breakpoints are correctly managed per-step, tool caching annotated.
- ✅ **Context pruning** — rolling pruning per step with separate logic for turn-level vs step-level to preserve cache.
- ✅ **No max steps or tool call limits** — `stopWhen: () => false` with user interrupt only.
- ✅ **MCP support** — StreamableHTTP with SSE fallback and stdio, tool names prefixed with server name.
- ✅ **Session management** — sqlite-backed, resume/new/list/switch all working.
- ✅ **OAuth** — Anthropic OAuth with PKCE, token caching, priority over env var.

### Minor observations

6. **`loadSkillsIndex` is called multiple times per interaction** — once in `buildSystemPrompt`, once in help, once in command dispatch. Each call re-scans the filesystem. The scan is fast (reads only frontmatter), but caching would be cleaner.

7. **`autoTitleSession` is called on every `processUserInput` call**, not just the first. The underlying `setSessionTitle` should be idempotent (only sets if untitled), but it hits the DB every turn.

## UI/UX Alignment

### What matches the core idea

- **Banner** — correctly shows version, model, cwd, AGENTS.md files, skills count, connected providers, and helpful keybindings. Clean and informative.
- **Status bar** — shows model, session ID, git branch, thinking effort, token counts, context percentage. Updated between turns. Matches the spec.
- **Tool rendering** — shell commands show the command then output. MCP tools prefixed with server name. Skill tools show one-line name + description.
- **Spinner** — inline spinner with label ("thinking", "running shell") visible during processing. Disappears cleanly.
- **Reasoning display** — reasoning blocks clearly indented with `· reasoning` prefix. Togglable with `/reasoning`.
- **Error handling** — errors logged and displayed as one-line summaries; user returned to prompt.
- **ESC interrupt** — works correctly, preserves partial response in history.

### Cross-provider UI consistency

All 5 tested paths produce consistent output formatting:

- Tool call lines use the same `?`/`$`/`←` glyph vocabulary across providers.
- Streaming text renders incrementally with the `◆` assistant glyph.
- Status bar format is identical across providers.
- Reasoning display works for Anthropic (native), Gemini (thinking), and OpenAI (commentary → reasoning mapping). This is impressively uniform given the SDK differences.

### Notable UI findings

8. **GPT parallel tool calls display overlap.** When gpt-5.4-nano made parallel tool calls, the display showed an unusual nested format with `↳` prefix. While readable, it's denser than the sequential display from other providers. This is functional but visually less clean.

9. **Verbose output enabled by default.** Both `reasoning: on` and `verbose: on` were shown in the banner. For most users, the default should probably be non-verbose (truncated) to avoid wall-of-text outputs. This matches the core idea's "shell tool: model can [get large outputs]" concern — truncation should be the default for large tool outputs.

## Recommendations

### Immediate bugs

- **Fix status bar token tracking after ESC interrupt** — the interrupt path should still update `totalIn`/`totalOut`/`lastContextTokens` from the turn error event's partial data.

### Code changes

- **Remove `/agent` from mini-coder skill SKILL.md** — or implement it. Currently it's misleading documentation.
- **Consider splitting `turn-execution.ts`** — the stream normalization classes (`StreamToolCallTracker`, `StreamTextPhaseTracker`) and the tool conversion logic could be separate files, improving readability.

### Polish items

- **Cache `loadSkillsIndex` result per-turn** — avoid redundant filesystem scans within a single interaction cycle.
- **Make `autoTitleSession` skip DB calls after first title** — add a flag to `ActiveSession` to avoid repeated no-op DB writes.
- **Review `verbose: on` as default** — the core idea emphasizes truncation for large outputs; having verbose on by default works against this.
