# Human's TODO list.

> This file is managed by the user, only edit if asked to.

- [ ] Use this `https://github.com/steveukx/git-js/blob/main/simple-git/typings/response.d.ts#L326`

- `src/tui.ts:248` tool timing is still cumulative for later tool calls\*\*
  The new duration is computed from `msg.timestamp`, which is set when the tool call is first shown, not when that specific tool
  runner starts. Since `streamAgent` executes tool calls serially, the second/third tool in one assistant turn will show a duration
  that includes time spent waiting on earlier tools, so the displayed `Took ...` is inaccurate.
