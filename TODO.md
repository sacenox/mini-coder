# Human's TODO list.

> This file is managed by the user, only edit if asked to.

## TODO

- [ ] Replace the custom spinner and always-on render loop with cel-tui's managed `Spinner` or `createTicker`.
- [ ] Replace the custom select overlay state and input handling with cel-tui's `Select`.
- [ ] Refactor tool-call TUI items so running, completed, failed, and aborted calls are unambiguous.
- [ ] Show provider-reported usage in the TUI rather than recomputing estimates on each message or tool stream event.
- [ ] Path autocomplete in TUI — `Tab` on file paths opens path picker.
- [ ] Status bar richness — detailed git counts (staged/modified/untracked/ahead/behind).

## Low priority / future enhancements

- [ ] List virtualization — adopt cel-tui's `VirtualList` for conversation history if long-session rendering becomes a measured problem.
