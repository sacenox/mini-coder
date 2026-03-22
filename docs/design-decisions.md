# Design Decisions

Documenting why mini-coder makes certain architectural choices — especially where we intentionally diverge from common patterns.

## Why no tool-call permissions?

**Decision:** No approval prompts, no blacklists, no whitelists. Every tool call executes immediately.

Our inspirations (Claude Code, OpenCode) require user approval for tool calls — shell commands, file writes, etc. We intentionally skip this.

### Permission systems provide a false sense of security

- **Shell bypasses everything.** An LLM with shell access can `curl`, `eval`, pipe through `bash`, encode payloads, or chain commands in ways no static blacklist can anticipate. Any permission scheme that allows shell but blocks specific patterns is playing whack-a-mole.
- **Blacklists and whitelists always have gaps.** Block `rm -rf /`? The model uses `find -delete`. Block `git push --force`? It uses `git push origin +main`. The surface area is unbounded.
- **Approval fatigue degrades security.** After the 20th "Allow shell command?" prompt, users auto-approve everything. The permission system trains the user to click "yes" reflexively — the opposite of its intent.

### Permissions are cumbersome

A coding agent runs dozens of shell commands per task. Requiring approval for each one destroys the flow that makes a CLI agent useful. The whole point of mini-coder is: small, fast, stays out of the way.

### Isolation is a separate concern

Sandboxing is a real need, but it belongs at the OS/container level — not inside the agent. Tools like [nono](https://nono.sh/) provide proper filesystem and network isolation that the LLM cannot circumvent. This is defense in depth done right: the agent runs unrestricted inside a sandbox that enforces actual boundaries.

### Our approach

- The system prompt includes safety rules (no secrets, confirm destructive actions, no unauthorized reverts).
- The user can interrupt at any time with ESC (preserve context) or Ctrl+C (hard exit).
- For real isolation, run mini-coder inside a sandboxed environment.

**Summary:** Permission dialogs give the appearance of safety without the substance. Real security comes from sandboxing the environment, not gatekeeping individual tool calls. Mini-coder codes — isolating it is a job for the right tool.
