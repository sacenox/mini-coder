# Human's TODO list.

> This file is managed by the user, only edit if asked to.

## TODO

- [ ] `read` tool --read file with offset and limit.
- [ ] `readImage` tool — embed image files in prompts (big real gap). Also update `tui-conversation.ts` `messageCacheKey` and `toolMessageNode` to handle image blocks.
- [ ] Session fork/undo — either tree-view forking (like pi coding agent) or undo flow, or both. Complex feature, needs UI and storage design.
- [ ] Path autocomplete in TUI — `Tab` on file paths opens path picker.
- [ ] Status bar richness — detailed git counts (staged/modified/untracked/ahead/behind).

## TODO: Better prompts, tools descriptions and reminder prompt engineering.

Raw notes, references:

### JetBrains Junie: Observation Masking

Published research found that **simply hiding old tool outputs** matched the quality of full LLM summarization with **zero extra compute**:

> good lessons from claude and general advice, seems good and grounded on real experience. Matches with learnings.
> https://www.indiehackers.com/post/the-complete-guide-to-writing-agent-system-prompts-lessons-from-reverse-engineering-claude-code-6e18d54294

> How pi coding agent does it, minimal and structured, a good approach, but we can be even more focused and minimal.
> https://raw.githubusercontent.com/badlogic/pi-mono/refs/heads/main/packages/coding-agent/src/core/system-prompt.ts

### Prompt learnings:

> Key sentence to add:

```
Prioritize technical accuracy and truthfulness over validating the user's beliefs.
Focus on facts and problem-solving, providing direct, objective technical info
without any unnecessary superlatives, praise, or emotional validation.
```

More reading material:

- https://arxiv.org/html/2601.16507v1#S3
