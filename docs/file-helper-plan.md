# File Helper and Tooling Refactor Plan

## Summary

We are moving away from making the LLM directly operate the current hashline `read` / `replace` / `insert` protocol as the primary editing path.

The root problem is not only stale anchors or poor recovery. The bigger issue is that the current model-facing edit API is too complex and stateful for reliable use:

- `read` returns decorated lines that must be translated back into plain text
- edits require choosing between several write modes
- writes are coupled to prior reads and exact anchors
- models frequently produce valid-looking but bad edits, then enter reread / repair loops
- shell becomes the escape hatch when structured edits break down

The new direction is:

- prefer **shell-driven workflows** for reading, searching, verification, and other general repo actions
- provide a **dedicated helper CLI binary** for one thing only: safe, token-conscious file edits
- keep shared logic in **internal packages**, with thin bin entrypoints
- remove the old hashline-based edit tools and update prompts/tool guidance to reflect the new approach

---

## Decisions

### 1. Prefer shell + helper CLI over direct hashline editing

The agent should primarily edit files via shell commands that call a purpose-built helper CLI, instead of directly using `replace` / `insert` for most code changes.

Why:

- models are generally stronger with shell-shaped workflows
- a helper CLI can still enforce safety and deterministic behavior
- this reduces the protocol burden compared with multi-step anchor editing
- it gives us a simpler model-facing interface without giving up control

### 2. Use a separate helper binary, not `mc file ...`

We should expose a separate executable for file operations instead of overloading the main `mc` CLI.

Why:

- cleaner mental model:
  - `mc` = agent CLI
  - helper bin = deterministic file operations
- lower command ambiguity for models
- easier to evolve independently
- easier to document as a narrow, machine-oriented interface

Working name examples:

- `mc-edit`

Final naming can be decided later, but it should be a separate bin.

### 3. Shared code should live in internal packages

The helper bin and the main CLI must not share logic by importing each other’s entrypoints.

Instead, shared implementation should be extracted into internal packages / internal modules.

High-level principle:

- bins are thin adapters
- reusable logic lives below them
- tests should target internal packages directly where possible
- Consider migration to a typescript monorepo or just nested packages

---

## Proposed architecture

## Binaries

- `mc`
  - existing agent CLI
- `mc-edit`
  - single-purpose safe edit helper, intended to be invoked from shell

## Internal packages / modules

Suggested initial layout:

- `src/internal/file-edit/`
  - path resolution
  - edit planning and application
  - stale-state checks
  - result metadata

Exact layout can be refined during implementation. The important constraint is that the bin stays thin and the editing logic lives in shared internals.

A key simplification here is that we are **not** designing a broad file-operations CLI. Shell already covers reading, searching, moving files, and orchestration well enough. The helper only needs to solve one problem: safe partial file edits.

---

## Design goals

The helper CLI should optimize for **model reliability**, **determinism**, **safety**, and **token efficiency**.

### Reliability goals

- one simple mental model for edits
- avoid anchor bookkeeping entirely in the model-facing API
- keep the operation narrow enough that the model can use it consistently
- make stale state explicit and easy to recover from

### Safety goals

- apply targeted edits instead of defaulting to whole-file rewrites
- fail clearly when the expected target no longer matches
- avoid silent partial success

### Token and performance goals

- avoid full-file rewrites for ordinary edits
- keep helper invocations and outputs compact
- reduce reread / repair loops caused by bad accepted edits
- preserve existing repo performance standards

---

## Model-facing API direction

We should keep the helper CLI as small as possible.

The shell tool is already sufficient for:

- reading files
- searching code
- inspecting directories
- running tests and verification
- composing temporary files when needed

We do not need to duplicate any of that functionality in the helper.

`mc-edit` should do one thing only: apply a safe partial edit to a file without requiring a whole-file overwrite.

The exact invocation details can be finalized during implementation, but the shape should stay minimal:

- one binary
- one edit operation
- targeted file edits
- clear failure when the expected target no longer matches
- compact, machine-friendly output

The helper exists to make ordinary edits reliable and token-conscious. It should not grow into a general-purpose file command suite.

---

## Output principles

The helper CLI should be machine-oriented first.

Preferred traits:

- stable output format
- minimal verbosity
- easy success/failure detection
- compact enough for shell use

Current leaning: keep the output as small and rigid as possible so the model can use it consistently.

---

## Relationship to existing tools

- do not expand the current hashline protocol further
- do not keep the old edit tools as a fallback path
- once `mc-edit` is proven out, remove `replace` / `insert` / related hashline edit plumbing and clean up the associated prompting
- any shared logic worth keeping should be extracted into the new internal package rather than preserved through compatibility layers

Important: the goal is simplification, not running two editing systems indefinitely.

---

## Migration strategy

### Phase 1: Extract internals

- move reusable file-edit logic into an internal package
- keep the extraction narrowly focused on safe partial edit application
- add focused tests around success and failure behavior

### Phase 2: Add `mc-edit`

- add `mc-edit` as a separate binary
- implement only the minimal safe-edit behavior
- ensure the output contract is stable and compact

### Phase 3: Switch the agent path

- update agent guidance to prefer shell + `mc-edit`
- stop steering the model toward hashline edits
- monitor behavior in the session DB

### Phase 4: Remove old edit tools

- delete the old hashline-based edit tools and their supporting code
- remove obsolete tests, prompts, and documentation
- keep only the new editing path

---

## Success criteria

This refactor is successful if we observe meaningful reduction in:

- reread / edit loops on the same file
- overlapping repair edits after a "successful" write
- malformed but accepted edit payloads
- need to abandon the safe edit path and fall back to raw shell rewrites

And improvement in:

- task completion reliability
- model confidence after edits
- token efficiency of normal edits
- maintainability of the editing stack

---

## Non-goals

For this effort, we are **not** trying to:

- perfect the existing hashline anchor format
- add more anchor variants or richer line matching as the main strategy
- turn the main `mc` CLI into a multi-purpose file helper interface
- build a broad file-management helper that duplicates shell capabilities
- add multiple helper subcommands or grow a larger command surface

Those may still be useful in limited contexts, but they are not the primary direction.

---

## Open questions for implementation

These can be finalized during the implementation phase:

- final helper binary name and exact invocation shape -- `mc-edit`
- the simplest safe matching strategy for partial edits
- exact result format on success and failure
- the cleanest removal sequence for the old edit tools and their prompt wiring

---

## Implementation guidance for future work

Implementation should stay scoped and incremental:

1. extract internal file-edit primitives first
2. add the separate helper bin second
3. keep the command surface to a single edit behavior
4. add focused tests before broad integration changes
5. switch agent behavior and then remove the old tools

Do not begin by expanding the current hashline API. The point of this effort is to replace it with a much simpler editing contract, not add more protocol complexity.
