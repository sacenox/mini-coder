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

# Tools output

Insert/read/edit/write/grep all were changed with the hashline feature, outputs needs
to be re-done to match our style of nice formatted data.

Subagent needs visibity on the ui somehow... that accounts for multiple in parallel... Needs planning, maybe a tree view showing the subagent's tool calls before the output.

---
