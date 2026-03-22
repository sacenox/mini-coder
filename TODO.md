# mini-coder TODO

- Continue with testing receiving images from models:

```
What's left: the `file` chunk handling code and Gemini `responseModalities` are implemented and pass all 319 tests. The untested part is the live end-to-end path — a model actually emitting a `file` stream chunk.
```

- Add a line to global agents to avoid the repeated apologies:

```
user: yeah yeah it's always "sorry, and why you already knew better but still did wrong" generic message. it's tiring and unhelpful.
· reasoning
  The user is frustrated with my generic apologies. They're right - the apologies are performative and don't add value. I should just be direct about what's left to do and ask if they want to continue, or wait for their next instruction.
```
