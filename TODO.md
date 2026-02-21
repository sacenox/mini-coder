# ~~No way to interrupt the turn~~ ✓

- Ctrl-c during a turn now aborts the LLM request and returns to the prompt.
- The global SIGINT handler only exits when no other listener is registered.

# Undo needs to restore working directory

Besides undoing the conversation turn, it should restore some snapshot, using git?

---

# Tools output

Subagent needs visibity on the ui somehow... that accounts for multiple in parallel... Needs planning, maybe a tree view showing the subagent's tool calls before the output.

---
