# PROGRESS

## Conversation summary

We reviewed ideas from:

- HumanLayer's advanced context engineering / 12-factor agents work
- several coding-agent implementations and docs, especially Pi, Codex, OpenCode, Gemini CLI, Amp, and Forge

The main conclusion from this round:

- mini-coder should stay fairly **shell-leaning** overall
- but **file reading** and **content search** should be **dedicated tools**, because shell commands are too ambiguous for those jobs
  - reading can happen through `cat`, `sed`, `awk`, `head`, `tail`, etc.
  - searching can happen through `grep`, `rg`, `find`, `fd`, etc.
- for simpler repo exploration, shell is still fine
  - prefer `ls` for directory listing
  - prefer `fd` for file discovery

## Chosen direction

The best next direction is:

1. **Copy/adapt Pi's `read()` tool implementation** for mini-coder
2. **Copy/adapt Pi's `grep()` tool implementation** for mini-coder
3. Update mini-coder's prompt so it clearly teaches the model:
   - use `read()` for reading files
   - use `grep()` for content search
   - use shell `ls` and `fd` for lightweight exploration
4. Keep `shell` as the fallback tool for everything else, not the primary interface for reading/searching code

## Why this direction

- Pi's read/search tools are the cleanest practical baseline we found
- Codex reinforces the value of keeping search/read more explicit than raw shell
- Shell remains valuable, but it is a weak interface for precise read/search intent because the model has too many equivalent command shapes to choose from
- `ls` and `fd` are simple enough that dedicated tools are probably not worth adding right now

## Important research notes

### Pi

Useful patterns worth copying:

- `read(path, offset, limit)`
- `grep(pattern, path?, glob?, ignoreCase?, literal?, context?, limit?)`
- clear truncation behavior
- clear continuation hints like `use offset=...`
- explicit tool guidance telling the model to prefer `read` over `cat`/`sed`

### Codex

Useful conceptual takeaway:

- dedicated tools for common read/search operations are better than forcing everything through shell
- search can often narrow candidates first, then follow up with read

### OpenCode / Gemini CLI / Amp

Useful secondary ideas:

- good tool descriptions matter a lot
- for open-ended exploration, subagents/delegation can help keep context cleaner
- Gemini's grep implementation had strong ideas, especially structured `rg --json` handling and auto-context for small result sets

## Current recommendation for implementation

Keep scope narrow.

Do **not** add a big new tool surface yet.

Implement only:

- dedicated `read` tool
- dedicated `grep` tool
- prompt clarification that `ls` and `fd` are the preferred shell commands for exploration

Avoid adding new `ls` / `find` / `glob` tools for now unless later testing shows they are needed.

## UI decisions from follow-up discussion

These details are now decided for the first `read` / `grep` implementation pass:

- `read` and `grep` tool-call previews should use the existing shared tool frame and stream their arguments in a structured, styled format rather than raw JSON.
- Those previews should follow the same `/verbose` behavior as the shell tool UI.
- `read` results should render syntax-highlighted file content as it streams in. That rendered body is still subject to `/verbose` UI truncation.
- The `read` result header should include the resolved file path after the `read <-` pill on the same line.
- `grep` results should render a structured, styled view derived from `rg --json`, focused on session-CWD-relative filenames and matches rather than raw JSON.
- `grep` result bodies should also follow `/verbose` UI behavior.
- Relative `grep` paths and displayed relative filenames should be based on the session CWD.
- Keep tool concerns separate from UI concerns: tool-level truncation / continuation behavior and UI `/verbose` rendering stay independent.

## Likely files to touch later

When implementation starts, the likely areas are:

- `src/tools.ts`
- `src/prompt.ts`
- maybe `src/ui/conversation.ts` if tool rendering needs special treatment
- maybe tests in `src/tools.test.ts`, `src/prompt.test.ts`, and `src/agent.test.ts`

## Open question to keep in mind

If we copy Pi's read/search behavior, we should decide whether `read()` should follow the same ignore/security expectations as search tools. One real issue seen in other agents is inconsistent behavior where search respects ignore rules but direct read bypasses them.

## Status at the end of this context

Nothing has been implemented yet from this decision. The chosen tool surface and the intended `read` / `grep` UI behavior are now documented and should be treated as the plan for the next implementation pass.

This file exists only to preserve the research outcome and chosen direction so a new context can continue from here without redoing the comparison.
