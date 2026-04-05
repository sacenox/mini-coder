# Mini Coder — Agent Instructions

- **Spec-driven development**: `spec.md` is the single source of truth for design and behavior. Read it before making changes. Do not deviate from the spec without discussion.
- **TDD**: write tests first, then implement. Tests validate the spec's defined behaviors.
- Use Conventional Commits formatting for commit messages.
- Before committing code changes, review the diff with the user and get approval for the commit.

## Repo

- Runtime: Bun. Use `bun run` for scripts, `bun test` for tests, `bun install` for deps, `bunx` instead of `npx`.
- Toolchain split: **prettier** owns all formatting, **biome** owns linting + import sorting (formatter disabled to avoid conflicts). Both fail CI on violations.
  - `bun run check` — biome: lint rules + organize imports.
  - `bun run format` — prettier: check formatting.
  - `bun run typecheck` — tsc --noEmit.
  - `bun test` — bun test runner.
  - `bun run check:fix` / `bun run format:fix` — auto-fix.
- Lefthook pre-commit runs all four steps sequentially (`--silent`, `parallel: false`).
- App data directory: `~/.config/mini-coder/`.
- All exports should have JSDoc comments (descriptions, `@param`, `@returns`). Interface fields get single-line JSDoc. See `session.ts` for the established pattern.
- Key dependency source code for reference:
  - pi-ai: `~/src/pi-mono/packages/ai/` — LLM provider SDK. See `src/types.ts` for core types, `src/stream.ts` for streaming API, `src/utils/oauth/` for OAuth, `src/providers/faux.ts` for test provider.
  - cel-tui: `~/src/cel-tui/` — TUI framework. See `spec.md` for full API, `examples/chat.ts` for the chat UI pattern, `packages/components/src/markdown.ts` for Markdown component.

## Code style

- Do not inline `import` calls. Don't duplicate code. Don't leave dead code behind.
- Don't re-implement helpers that already exist, always consolidate.
- Keep it minimal — don't add abstractions for hypothetical futures.
- Performance matters. Prefer fast paths.

## Working with dependencies

- **Study before using.** Before writing code against a dependency, read its examples, types, and tsconfig. Match the dependency's conventions — don't fight them.
- **Match tsconfig constraints.** If a dependency ships `.ts` source (e.g., cel-tui), our tsconfig must be compatible with theirs. Relax our config to match, not the other way around. Never add lint-ignore comments or type casts to work around mismatched strictness settings.
- **Follow established patterns.** Dependencies with examples (e.g., `cel-tui/examples/chat.ts`) define the canonical usage patterns. Copy those patterns exactly before customizing. Don't invent alternative approaches.
- **Verify visual correctness.** For UI code, think through rendering on both light and dark terminals. Test color choices against both backgrounds. The spec says "adapts to the user's terminal color scheme" — that means colors must be legible in both contexts.
- **Understand layout before rendering.** For TUI frameworks, understand how the layout engine determines dimensions (intrinsic vs fixed vs flex vs fill). Never hardcode dimensions that the framework should compute.

## Lessons learned

- **Never rush an implementation.** A broken implementation that compiles is worse than no implementation — it wastes review time, erodes trust, and the rework costs more than doing it right the first time.
- **Don't suppress lint warnings for future code.** If code doesn't exist yet, don't add `biome-ignore` or `// @ts-ignore` comments for it. Add them when the code actually exists.
- **Dead guards are lies.** Type guards for impossible types (e.g., `typeof c !== "string"` when the type is `TextContent | ThinkingContent | ToolCall`) suggest the type can contain those values. They mislead readers and should not exist.
- **Event APIs must carry their data.** When an event handler needs data from the event source (e.g., tool call arguments), the event must carry that data. Walking external state to reconstruct it is fragile and breaks with duplicate entries.
- **Async callbacks must handle errors.** When a sync callback invokes an async function, the returned promise must be caught. Dropping it silently turns errors into unhandled rejections.
- **Respect the phased plan.** Each TODO.md phase has explicit scope. Do not implement features from later phases — even if they feel "easy" or "related." Scope creep wastes review time, introduces bugs from untested code paths, and erodes trust. If something isn't listed in the current phase, it doesn't exist yet.
- **Understand callback return semantics.** In cel-tui's `onKeyPress`, returning `false` means "prevent the default action" — returning it unconditionally blocks all typing. Only return `false` for keys you explicitly intercept. Let all other keys fall through with no return.
- **Use the dependency's types, not weaker ones.** If a dependency defines a specific type (e.g., cel-tui's `Color`), use it in your own interfaces. Don't weaken to `string` and then cast with `as any` everywhere — that defeats type safety and creates lint noise.

## Testing strategy

We test our logic at the boundaries. Never test dependencies (pi-ai, cel-tui, bun:sqlite). Never use mocks or stubs.

**Tools** (`tools.ts` — `shell`, `edit`, `readImage`):

- `edit`: exact-text match/replace, multi-match failure, missing text failure, new file creation, parent dir creation, existing-file guard, line ending preservation (LF/CRLF), UTF-8 handling, relative/absolute path resolution.
- `shell`: stdout/stderr capture, exit code passthrough, output truncation (head + tail with marker), abort signal, cwd propagation.
- `truncateOutput`: pure function — within limit, head+tail+marker, no overlap, empty/single-line/exact-limit edge cases.
- `readImage`: base64 encoding, mime type detection, unsupported format rejection, missing file handling, relative/absolute path resolution.

**Git** (`git.ts`):

- Real temp git repos (no mocks). Tests: outside-repo null, repo root, branch name, untracked/modified/staged counts, mixed states, ahead/behind with local bare remote, subdirectory support.

**Session persistence** (`session.ts`):

- CRUD operations against a real bun:sqlite in-memory database. No mocks.
- Turn numbering: user message gets MAX+1, subsequent messages share the turn.
- Undo: deletes correct turn, leaves others intact.
- Fork: copies all messages, new session id, preserves turn order.
- Cumulative stats computation from message history.

**System prompt construction** (`prompt.ts`):

- Assembly order: base + AGENTS.md + skills + plugins + footer.
- Git line formatting: branch, dirty counts, ahead/behind, omission rules.
- Skills catalog XML generation.
- Conditional readImage exclusion from prompt text.

**Community standards discovery** (`skills.ts`, AGENTS.md loading):

- Skill discovery: scan paths, SKILL.md parsing, frontmatter extraction, name collision resolution.
- AGENTS.md discovery: walk to scan root, ordering, `~/.agents/` inclusion.
- Use temp directories with controlled file trees.

**Agent loop** (`agent.ts`):

- Use pi-ai's `faux` provider for end-to-end loop tests.
- The loop takes `tools: Tool[]` (definitions for the model) and `toolHandlers: Map<string, ToolHandler>` (dispatch map). Tests build both via helper functions.
- Verify: tool calls are executed, messages are appended in correct order, turns are numbered, interrupt preserves partial response, error handling, unknown tool self-correction, length stop reason.

**Input parsing** (`input.ts`):

- `/command` detection and routing (all 11 commands, case-sensitive, unknown commands fall through).
- `/skill:name rest of message` → skill name + user text extraction.
- Image path detection (entire input is an existing image path with valid extension, requires `supportsImages` opt-in).
- Priority ordering: commands > skills > images > plain text.

**Theme** (`theme.ts`):

- Default theme has all required keys (9 terminal palette colors).
- `mergeThemes` applies partial overrides left-to-right without mutating the base.
