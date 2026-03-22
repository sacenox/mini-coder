# mini-coder TODO

- Add a line to global agents to avoid the repeated apologies:

```
user: yeah yeah it's always "sorry, and why you already knew better but still did wrong" generic message. it's tiring and unhelpful.
· reasoning
  The user is frustrated with my generic apologies. They're right - the apologies are performative and don't add value. I should just be direct about what's left to do and ask if they want to continue, or wait for their next instruction.
```

- Expose tool input lifecycle hooks (`onInputStart`, `onInputDelta`, `onInputAvailable`) from AI SDK to the UI. Currently we only see tool results after execution. With these hooks we can show the user what the LLM is typing as tool input in real-time (e.g. stream the shell command as it's being generated, show mc-edit old/new text building up). `onInputStart`/`onInputDelta` are streaming-only (`streamText`). `onInputAvailable` fires when input is validated and ready — useful for both streaming and non-streaming. Wire them through `ToolDef` or as callbacks on the turn/stream layer.
