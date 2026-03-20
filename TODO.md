# TODO

- ~~mini coders uses 10x more tokens than claude using the anthropic subscription; this is likely an issue with caching not working correctly or our pruning resetting the cache.~~ Fixed: step pruning now anchors the tool-call window to the initial boundary (no prefix modification), preserves reasoning between steps, stabilizes cache breakpoints at last-user-message, and strips stale breakpoints. Falls back to full pruning past 200 messages.
- CTRL+d hangs sometimes and doesn't exit.

---

# Deferred fixes

- **Thinking effort breaks `claude-haiku-4-5` via Zen** — The model info cache (sourced from models.dev) marks `claude-haiku-4-5` as `reasoning: 1`. When a thinking effort is persisted (e.g. `medium`), the app sends `"thinking": {"type": "adaptive"}` which Zen (and likely the Anthropic API) rejects with a 400: _"adaptive thinking is not supported on this model"_. The `supportsThinking()` check is too broad — it trusts the models.dev flag but doesn't validate whether the specific model actually accepts the adaptive thinking API parameter. Without a persisted thinking effort the model works fine.
- **`zen/claude-3-5-haiku` 404** — The AI SDK auto-resolves `claude-3-5-haiku` to `claude-3-5-haiku-20241022`, which Zen doesn't serve. The Zen endpoint expects exactly `claude-3-5-haiku`. This is an SDK behaviour issue that may need a workaround or documentation.
- Several truncation helpers across the cli module files, consolidate in a cli/truncate.ts for rendering truncation.
- Consolidate `parseSkillFrontmatter` in `skills.ts` with `parseFrontmatter` in `frontmatter.ts` — they do the same YAML-lite parsing with different field sets.
- Status bar: combine model name with thinking effort into a single field (e.g. `provider/model medium`), and remove `showReasoning` from the status bar since it is already shown in the banner.
- When a shell tool call hits max timeout, the turn ends and the parent terminal is left in a broken state.
- **MiniMax empty lines in one-shot** — Investigate empty text deltas. May need to skip rendering deltas that are only whitespace at stream start.
- **Double prompt glyph after ESC** — The `turn-complete` handler writes a newline when `!renderedVisibleOutput`, then the input loop also writes its prompt. May need coordination to avoid the double prompt.
- **No conversation summary on max context** — The idea says "Stops with a conversation summary if max context is reached." Currently shows an error and suggests `/new` without generating a summary of the conversation.
- **Truncated tool commands** — Long `mc-edit` invocations truncate with `…` mid-argument (e.g. `--new '{…`). Could truncate at argument boundaries for clarity.
- `maxOutputTokens` is hardcoded at 16384 in `turn-request.ts`. Some models support higher output (e.g. Claude Opus 32k). Consider deriving from model info or making it configurable.
- `/_debug` hidden command that snapshots recent logs/db and creates a report in the cwd. For dev mostly but available to all. Do not list it anywhere, only documented here and in the code itself.
- Check this skill to learn about tmux and how we can use it to run manual tests. https://raw.githubusercontent.com/obra/superpowers-lab/refs/heads/main/skills/using-tmux-for-interactive-commands/SKILL.md
