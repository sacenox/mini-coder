# `cwd` leaks into tool schemas

All file tools expose `cwd` in their Zod schema, so the LLM sees it as a callable parameter. It's always injected by `withCwdDefault()` and should be hidden from the model.

Causes confusion

```
▶ create a readme file and introduce yourself
  ✎ create README.md
    ✖ EACCES: permission denied, mkdir '/root/src/mini-coder'
  ✎ create README.md
    ✖ EACCES: permission denied, mkdir '/home/sandbox'
  $ $ pwd
    ✔ 0
    │ /home/xonecas/src/mini-coder
  ✎ create README.md
```

---

# Fix implementation error

1. The DB only saves text — agent.ts:412–429 strips tool parts before writing to SQLite. That's the right design for persistence, but coreHistory in memory is never trimmed.

- Refactor sessions table to include content, tool call pairs and everything we need to remake
the history on resume. This breaks the schema, this is ok, we generate a new one.
- Ensure we don't break message format expected by the sdks.

---

src/tools/subagent.ts -- It should not include a model choice 

---

# Undo needs to restore working directory

Besides undoing the conversation turn, it should restore some snapshot, using git?

---

# Plan mode changes

- Allow read tools + mcp
- When plan mode is on, add a `<system-message>PLAN MODE ACTIVE -- READ ONLY</system-message>` suffix to the user messages.

---

# Fix tools not saved to db.

- We are breaking existing sessions on resume, update the db and code to store the full session messages.

---

Subagent needs visibity on the ui somehow... that accounts for multiple in parallel... Needs planning, maybe a tree view showing the subagent's tool calls before the output.

---
