# TODO

---

## Usbaility issues:

- Subagents are way less competent than the main agent


- All models: constant reading almost no action, lot's of wasted tokens, using opencode or claude code is a much more action oriented workflow.
- Ralph mode is completly broken, most models just exit the loop without completing anything, or after reading the context.

---

## Subagents don't know where they are:

Subagents are trying to guess paths, this is terrible... We need to make sure subagents don't make stupid mistakes like this, it breaks trust, and trust in LLM's is already at an all time low.

```
▶ @TODO.md let's tackle the first todo and make propper use of shadcn and make a custom theme.
  ⇢ subagent Read these files and return their full contents:
1. ~/src…
  ⇢ subagent In the directory ~/src/99prompt/web, find and return the …
[ff476f3f] ← read ~/src/99prompt/web/idea.md
[ff476f3f]   ✖ File not found: ~/src/99prompt/web/idea.md
[ff476f3f] ← read ~/src/99prompt/web/website.md
[ff476f3f]   ✖ File not found: ~/src/99prompt/web/website.md
[ff476f3f] ← read ~/src/99prompt/web/src/app/globals.css
[ff476f3f]   ✖ File not found: ~/src/99prompt/web/src/app/globals.css
[ff476f3f] ← read ~/src/99prompt/web/components.json
[ff476f3f]   ✖ File not found: ~/src/99prompt/web/components.json
[76f32dc8] ? glob /Users/*/src/99prompt/web/src/components/ui/**/*
[76f32dc8]   · 1 file
[76f32dc8] ? glob /Users/*/src/99prompt/web/src/app/**/layout.tsx
[76f32dc8]   · 3 files
[76f32dc8] ? glob /Users/*/src/99prompt/web/src/app/[locale]/page.tsx
[76f32dc8]   · no matches
[ff476f3f] $ echo $HOME
[ff476f3f]   ✔ 0
[ff476f3f] ← read /Users/seancaetanomartin/src/99prompt/web/idea.md
[ff476f3f]   · 31 lines
```

---

## Write blog posts

- Codex being big dumb and lazy without strong guidance in system prompt/instructions
- Keeping up codebase health when using agents to develop an applications. Avoid regressions, bad tests, lint etc.

---

# Post v1.0.0 work:

## Custom commands vs built-in commands vs subagents

We currently have a ton of overlap with these features, Commands run within subagents, some commands come from custom configs others are baked in.

Let's clean things up:

- `/review` command should use the same code as a custom-commands, consolidate the two. We can create the global `/review` command in `~/.agents/commands` at app start if it doesn't exist. That way it can be a pure custom command and the users are encouraged to edit it for their own custom reviews. Never overwrite the file if it exists. Print a line notifying the user that the command was created.

- Custom commands and custom subagents: Custom commands just spawn generic subagents with a dedicated prompt, custom agents are just subagents with a dedicated system prompt and a main agent provided prompt. I believe these are already well implemented, and share most of the code.

---

## LSP Diagnostics (not very important, with tool-hooks and strong linting, this is not as necessary, but we should implement asap)

We should have a closed loop feedback for LSP diagnostics on edits/reads.

This could potentially be a very big slowdown, waiting for updated diagnostics every edit. This also has bias downsides, stale diagnostics confuse the LLM, and can cause negative distractions.

We need to do research first, but maybe we can leverage the hooks feature to achieve a similar result without the performance penalties? Needs brainstorming

---

## Deferred fixes

- model-info: in `resolveFromProviderRow`, when canonical capability exists but `contextWindow` is null, fall back to provider row context (`capability.contextWindow ?? row.contextWindow`).
- Worktrees share bun lockfile and node_modules. Question this choice, is this really a good idea, or just an opportunity for things to go wrong?
