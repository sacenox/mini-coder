# File Helper Refactor Plan

## Status at a glance

This refactor is complete on this branch.

mini-coder now follows the intended shell-first model:

- `mc-edit` exists as a dedicated helper binary
- shared file-edit logic lives under `src/internal/file-edit/`
- shell exposes `mc-edit` as the targeted edit path
- the system prompt and tool surface are simplified around shell usage
- old model-facing local file tools are removed
- hook support is removed
- `/undo` is conversation-turn undo only

`/undo` no longer tries to restore filesystem state, which keeps the architecture honest with the real shell + `mc-edit` edit path.

---

## Why this refactor exists

The old hashline editing protocol (`read` + `replace` / `insert`) was too fragile for normal model use.

Problems with the old approach:

- `read` returned decorated `line:hash|` output instead of plain file text
- edits depended on exact protocol choreography across multiple tool calls
- models had to carry stale anchors and hashes across turns
- semantically correct edits often failed because the payload shape or anchor state was slightly wrong
- failures regularly degraded into reread-and-repair loops
- when that happened, shell was already the practical fallback

The point of this refactor was **not** to improve that protocol.
The point was to replace it with a simpler contract that matches how models already work best:

- inspect with shell
- edit with a narrow helper
- verify with shell

That is why `mc-edit` exists.

---

## Target architecture

### Final model-facing tool surface

The steady state is:

- connected **MCP tools**
- **`shell`**
- **`subagent`**
- **`listSkills`**
- **`readSkill`**
- **`webSearch`** and **`webContent`** when Exa is configured

Removed local runtime tools:

- `read`
- `create`
- `replace`
- `insert`
- hook-related runtime tooling

### Final file workflow

The intended workflow is:

1. inspect/search with shell
2. mutate files with `mc-edit`
3. verify with shell

`mc-edit` is intentionally narrow:

- exact-text edits only
- deterministic failure on stale or ambiguous state
- machine-friendly output
- no broad file-management abstraction beyond the edit helper itself

---

## What landed on this branch

### 1. Shared file-edit internals were extracted

Implemented under:

- `src/internal/file-edit/cli.ts`
- `src/internal/file-edit/exact-text.ts`
- `src/internal/file-edit/path.ts`
- `src/internal/file-edit/command.ts`

### 2. `mc-edit` was added as its own binary

Implemented via:

- `src/mc-edit.ts`
- `package.json`
- `scripts/build.ts`

### 3. The agent was moved to a shell-first editing model

Implemented via:

- shell prelude injection in `src/tools/shell.ts`
- prompt guidance in `src/agent/system-prompt.ts`
- shell tests covering `mc-edit` wiring

### 4. The old structured edit path was removed

Implemented by removing the hashline edit flow built around `replace` and `insert`, and by collapsing the surrounding plumbing that only existed to support that protocol.

### 5. The local tool surface was reduced

The local runtime surface is now centered on:

- `shell`
- `subagent`
- `listSkills`
- `readSkill`
- optional Exa tools

### 6. Hook support was removed instead of redesigned

This cleanup was part of the refactor because hooks were tied to the old, heavier local tool story and were not worth carrying forward in the middle of this architecture change.

### 7. CLI and docs cleanup was completed

Prompt text, tool rendering, help text, and docs now consistently reflect the shell-first model and the conversation-only `/undo` behavior.

---

## Key decisions

### 1. Shell is the primary interface for repo work

Shell is the default for:

- reading files
- searching
- running tests/builds
- git inspection
- verification
- invoking `mc-edit`

We are no longer optimizing around a large local file-tool API.

### 2. `mc-edit` is the safe path for targeted edits

We want one narrow edit helper instead of several model-facing edit tools.

That keeps the contract simpler:

- shell handles orchestration
- `mc-edit` handles exact mutation

### 3. `listSkills` and `readSkill` stay

These are not general-purpose file tools. They are support tools for community/project config and should remain available.

### 4. `read` and `create` should not remain as compatibility tools

If file inspection is shell-driven and edits are shell + `mc-edit`, keeping old local file tools around only muddies the contract.

### 5. Hooks are out for this refactor

The correct choice here is deletion, not redesign.

If hooks ever come back, that should happen as a separate effort with a clear use case.

### 6. `/undo` should stay aligned with the real edit path

The old snapshot model was built around tool-managed writes.
That no longer matches reality.

The correct result for this refactor is to keep `/undo` as conversation history undo only, not a filesystem restoration feature for shell-driven edits.

### 7. MCP descriptions matter more now

With fewer local tools, MCP tools take up a larger share of the model-visible surface.
Their names and descriptions should stay concise and easy to distinguish from shell work.

---

## Completion status

### 1. Redesign `/undo`

This work is done.

#### What changed

Undo no longer depends on the old snapshot path.
The snapshot-specific pieces were removed, including:

- `src/tools/snapshot.ts`
- `src/agent/undo-snapshot.ts`
- `src/session/db/snapshot-repo.ts`

`/undo` now removes only the most recent conversation turn from session history.
It does not try to infer or restore filesystem state from shell-driven edits.

#### Result

- `/undo` doesn't manage filesystem changes
- snapshotting is removed from runtime code and docs

---

### 2. Finish the docs and help-text consistency pass

This work is done.

README, config/docs pages, bundled commands/skills guidance, and `mini-coder-idea.md` consistently describe the shell-first model, name `mc-edit` as the targeted edit path, and keep `/undo` scoped to conversation history only.

#### Done when

- docs match implementation
- examples reinforce shell + `mc-edit`
- there are no stale references to removed tools or hooks
- `/undo` is consistently described as conversation-history undo only

---

### 3. Final prompt, CLI, and rendering polish

This work is done.

The system prompt names the final built-in tool surface explicitly, `/help` keeps `/undo` aligned with the conversation-only guarantee, MCP tool descriptions are tighter, and skill-tool call/result rendering is compact and readable.

#### Done when

- prompt text exactly matches runtime behavior
- CLI output reflects only the remaining architecture
- MCP descriptions are concise and distinguishable

---

### 4. Verify the cleanup end-to-end

This work is done on this branch.

The runtime tool set is reduced to the intended surface, the bundled hook example files were removed, and the full repo verification command passes.

#### Repo verification command

Run:

```bash
bun run jscpd && bun run knip && bun run typecheck && bun run format && bun run lint && bun run test
```

Status on this branch: this command passes after the full shell-first cleanup.

---

## Completion checklist

This refactor is complete when all of the following are true:

- the model-visible tool surface is shell, subagent, listSkills, readSkill, connected MCP tools, and optional Exa tools
- `mc-edit` is the clear targeted edit path
- the old hashline edit path is fully gone
- hooks are fully gone from runtime, UI, and docs/examples
- `/undo` is aligned with the shell-first architecture by only undoing conversation history
- prompt, CLI, and docs all describe the same architecture
- bundled commands/skills/examples reinforce the shell-first workflow

---

## Non-goals

This effort is not trying to:

- improve the old hashline edit protocol
- keep old local edit tools as fallback paths
- redesign a new hook framework right now
- guarantee undo for arbitrary raw shell file operations
- turn `mc-edit` into a broad file-management CLI

---

## Practical conclusion

Compared to `main`, this branch completed the hard architectural shift: `mc-edit` exists, shell is the primary path, the old local edit model is gone, hooks are gone, and `/undo` is aligned with conversation history rather than filesystem restoration.

At this point, the refactor is complete in the intended sense:

- the model-visible tool surface is small and shell-first
- `mc-edit` is the clear targeted edit path
- prompt, CLI, docs, and bundled examples describe the same architecture
- verification passes on the branch

Future work can build on this baseline, but the file-helper refactor itself has reached its intended end state.
