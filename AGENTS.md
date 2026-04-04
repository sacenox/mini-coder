# Mini Coder — Agent Instructions

- **Spec-driven development**: `spec.md` is the single source of truth for design and behavior. Read it before making changes. Do not deviate from the spec without discussion.
- **TDD**: write tests first, then implement. Tests validate the spec's defined behaviors.
- Use Conventional Commits formatting for commit messages.
- Before committing code changes, review the diff with the user and get approval for the commit.

## Testing strategy

We test our logic at the boundaries. Never test dependencies (pi-ai, cel-tui, bun:sqlite).

**Tools** (`shell`, `edit`, `readImage`):

- `edit`: exact-text match/replace, multi-match failure, missing text failure, new file creation, line ending preservation, UTF-8 handling.
- `shell`: output truncation logic (head + tail with marker), exit code passthrough.
- `readImage`: base64 encoding, mime type detection, unsupported format rejection, missing file handling.
- Pure functions with clear inputs/outputs.

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
- Verify: tool calls are executed, messages are appended in correct order, turns are numbered, interrupt preserves partial response, context limit triggers compaction.

**Input parsing**:

- `/skill:name rest of message` → skill body + "rest of message".
- `/command` detection and routing.
- Image path detection (entire input is an image path that exists and has a valid extension).
