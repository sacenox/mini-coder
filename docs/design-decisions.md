# Design Decisions

Documenting why mini-coder makes certain architectural choices — especially where we intentionally diverge from AI SDK defaults or common patterns.

## Why not ToolLoopAgent?

**Decision:** Use `streamText` directly instead of the AI SDK's `ToolLoopAgent`.

`ToolLoopAgent` is a convenience wrapper that manages the tool-call loop, context, and stopping conditions. Mini-coder needs explicit control over every aspect it abstracts away:

- **Streaming event rendering** — We yield granular `TurnEvent`s (text deltas, tool calls, tool results, reasoning, context-pruned notifications) as they arrive from `fullStream`. The reporter renders them append-only into the terminal in real time. `ToolLoopAgent` gives you the final result; we need the firehose.
- **ESC interrupt mid-turn** — An `AbortController` is wired through to `streamText`'s `signal`. On ESC, we abort, preserve partial messages, and append an interrupt stub so the LLM retains context. `ToolLoopAgent` doesn't expose this kind of mid-stream abort-and-preserve behavior.
- **Custom context pruning** — After every turn, `SessionRunner` runs `applyContextPruning` + `compactToolResultPayloads` on the in-memory history. This is rolling, per-turn pruning that must not break prompt caching. `ToolLoopAgent`'s built-in context management doesn't match these constraints.
- **Per-step DB persistence** — Each turn's messages are saved to SQLite with a turn index as they complete. The in-memory `coreHistory` diverges from the DB history (pruned vs. full). `ToolLoopAgent` has no hook for this.
- **Provider-specific caching annotations** — `annotateToolCaching` adds caching metadata to the tool set based on the model string, injected directly into the `streamText` call.
- **No step/tool-call limits** — Per the design: "No max steps or tool call limits — user can interrupt." `ToolLoopAgent` defaults to `stopWhen: stepCountIs(20)`.

**Summary:** `ToolLoopAgent` reduces boilerplate for simple request→response agents. Mini-coder is a shell-first coding agent where the loop _is_ the product. Using `ToolLoopAgent` would mean fighting the abstraction at every turn.

## Why no cross-session memory?

**Decision:** No agent-managed persistent memory across sessions. The repo and user-authored config files are the memory.

The AI SDK offers several memory approaches (Anthropic memory tool, Mem0, Letta, custom tools) that let agents save facts and recall them in future conversations. We intentionally don't use any of these.

### What we have instead

- **Within-session persistence** — Full message history saved to SQLite per-turn, sessions resumable via `/session`.
- **Context pruning** — `applyContextPruning` and `applyStepPruning` strip old reasoning/tool-calls to fit context windows without breaking prompt caching.
- **Static cross-session context** — `AGENTS.md`/`CLAUDE.md` files loaded into the system prompt. This is user-curated project knowledge, not agent-managed memory.
- **Skills** — Reusable instruction sets discoverable via `/` autocomplete.

### Why not agent-written memory?

We considered having the agent write to `~/.agents/AGENTS.md` for cross-session recall. Rejected because:

- **Intrusive** — `~/.agents/` is the user's space. Agent writes would mix generated noise with intentional configuration, creating surprises ("where did this line come from?").
- **Violates conventions** — `AGENTS.md`/`CLAUDE.md` are community standards meant to be human-authored instructions _to_ the agent, not an agent scratchpad. Using them as memory inverts the relationship.
- **Safety conflict** — Our own system prompt requires confirmation before irreversible actions. Silently modifying a user's global config violates that principle.
- **Complexity** — Memory adds storage, retrieval, relevance ranking, and non-determinism. The design philosophy is performance first, minimal setup.

### If we ever want this

A dedicated `~/.config/mini-coder/memories.md` that's clearly agent-owned and separate from user config would be the right path — not overloading existing community standards.

**Summary:** For a coding agent that operates on a repo, the repo _is_ the memory. Users who want cross-session context write it in `AGENTS.md` themselves — that's an intentional act, not an LLM side effect.
