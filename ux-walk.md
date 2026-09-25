# Goal

Your goal is to drive the TUI through all possible states, screenshot or record
it, then analyze it from a user's perspective as a product manager and outline
all issues/bugs seen.

One pass with generic scenarios is not enough, you should stress edge cases and
try to break the UI. Generic prompts walk the happy path; the defects live in
widths, timings, interruptions, and terminal state after exit, so most of the
work is choosing inputs and geometries that a normal session never produces.

You shouldn't add scope, or break the existing user ux contract.

# Direction

- Observation only. Do not change the source, do not add tests or dependencies,
  do not fix what you find. The deliverable is the report.
- No scope. Findings must not propose anything the direction list defers
  (compaction, session resume, plugins, config TUI, MCP, sandboxing, prompts,
  custom agents, macOS/Windows support).
- The existing UX contract is the baseline, not a proposal. What the code does on
  purpose is intended behavior; report where the result diverges from it, and
  label subjective calls as taste instead of bugs. `AGENTS.md` invariants and
  direction are part of that contract; read the code for the rest.
- You are a user of the TUI, not its author. Judge what appears on screen, the
  input experience, and the terminal left behind afterwards — not the model's
  prose and not the provider's content.

# Harness first

Captures are worthless if the run isn't reproducible. Pin these before the first
walk:

- Run the TUI in a tmux pane at a fixed geometry and record that geometry with
  every capture. The pane's `TERM` must be a real terminal (`xterm-256color`,
  `screen-256color`): the app emits SGR, enables bracketed paste, and requests
  kitty keyboard flag 1, so a dumb terminal captures the wrong screen.
- Drive keys through tmux: `send-keys -l` for literal text, `send-keys` for named
  keys (`Enter`, `Escape`, `C-c`, `C-d`, `Tab`, `C-j`, `BTab`, `Up`, `M-b`).
  For a multi-line paste, use `set-buffer` + `paste-buffer -p` so the app sees
  real bracketed-paste markers; typing a newline through `send-keys -l` is a
  different input path. Enable `extended-keys` in the pane for `Shift+Enter`,
  but test that key once with extended keys off too, since that is what most
  users' terminals do.
- Capture the pane, not the screen: `tmux capture-pane -p -e` keeps styling and
  `-S -` includes the scrollback above the live region. One capture per state,
  named `<state>-<geometry>-<step>.txt`; diffing captures between steps is how
  you see exactly what one keypress changed.
- Record one full session at the byte level with `script -q -O run.log` inside
  the pane. That log is the only artifact showing the erase and redraw traffic
  the app actually emitted, which is where ghost rows, bad anchors, and
  duplicated scrollback show up.
- Keep everything the walk produces in one untracked run directory next to the
  report — `ux-walk-<date>/{captures,shots,sessions}/` — and run every test
  session with that directory as mini-coder's cwd: `sessionsDir` is left unset,
  so sessions land in `./sessions` under wherever mini-coder was started. Never
  start it at the repo root, or the walk writes into the development sessions.
  Running from the run directory also keeps the model's own `bash` and `edit`
  calls out of the repo. No config changes, no flags. Afterwards, confirm the
  development `sessions/` and the repo are untouched.
- Images are required, not a nicety: they are what the walk is judged on.
  Attach the tmux client to a GUI terminal at a fixed size, and take one image
  per state with `spectacle -a -b -n -o <run>/shots/<state>.png` — it grabs the
  focused window, so the terminal must be the active window (verified working on
  this Wayland/KDE session; under X11 `import -window <id>` is the fallback).
  If the window grab keeps missing, take `spectacle -f -b -n -o full.png` and
  crop with `convert -crop WxH+X+Y`.
  - Never assume the geometry: read the real pane size back
    (`tmux display -p '#{window_width}x#{window_height}'`) and record it next to
    the image, since window managers, remembered window sizes, and HiDPI scaling
    all change it. Size the GUI terminal yourself (`kitty -o
    remember_window_size=no -o initial_window_width=100c -o
    initial_window_height=30c`) so runs are comparable.
  - Verify every shot before moving on: `identify` it and look at it. A
    screenshot of the wrong window, a stale frame, or a half-drawn pane is worse
    than no screenshot, because it goes into the report as evidence.
  - Cover what a pixel grab uniquely shows: light theme and dark theme, cursor
    visibility and position, the spinner frame, dim versus normal intensity,
    wide characters and emoji, wrapped-token edges, and colors that text
    captures flatten into escapes.
- Use the provider and model already configured in `~/.config/mini-coder`, with
  short single-purpose prompts — one prompt per state you want to reach — so
  streaming, reasoning, tool calls, and usage numbers are all genuine. Reach the
  hostile shapes through the model too: ask it to run a command that prints a few
  hundred lines, to edit a file large enough to show a full diff, to read an
  image, to run something slow enough to catch mid-tool phases, or to write a
  long reply so you can interrupt it mid-stream. Coverage you cannot reach with
  the real provider (a provider error, a stalled stream) is reported as not
  covered rather than faked.

# States to walk

Derive the list from the code rather than trusting this file, but the walk is not
done until every one of these has been reached and captured:

Startup and idle

- banner `mini-coder · <provider>/<model>`, empty scrollback, status row showing
  only the context readout, cursor at column 0 of the editor.
- editor: empty draft, one line wrapping past the width, more lines than the
  viewport, caret at each wrap boundary, Home/End, Ctrl+A/Ctrl+E,
  Ctrl+Home/Ctrl+End, word motions, backspace/delete across a line join, Ctrl+W
  at line start, Tab on a non-command draft, paste of multi-line text and of a
  fence.
- command input: `/help` output, Tab completion on `/` and `/h`, `/unknown` on
  Enter (stays a model message), `/help` with trailing args.

Turn lifecycle

- every phase row, once each: `preparing`, `waiting for provider`, `streaming`,
  `running <tool>` — with spinner, elapsed seconds, and the usage half of the row.
- `paused - type steering, Enter to submit`, reached with Esc in every phase
  including while a tool runs; then steer with text, steer with empty Enter, and
  press Esc twice.
- a tool call whose result never arrives (cancel between the two), several calls
  in one assistant message, and call lines in execution order.
- terminal states: `[complete · Ns]`, `! cancelled`, `! <provider error>`,
  `! <tool error>`; plus the persistence failure path (unwritable
  `sessionsDir`), which must stop the turn.

Tool rendering

- bash: multi-line command collapsed into one call line, `exit N` appearing only
  on error, output long enough to elide with the head/tail split, output with
  `\r`, ANSI colors, tabs, and raw control bytes.
- edit: path on the call line, diff in full with file headers stripped and
  `@@`/`+`/`-`/context styled, create, and no-newline-at-EOF.
- read: text result, plus an image path on a model that accepts images and one
  that does not.
- markdown: fence with and without a language, unclosed fence still held when the
  turn ends or is cancelled, setext heading, table, nested list, a single token
  wider than the pane, wide characters and emoji at the wrap boundary, dimmed
  reasoning behind the in-flight preview.

Terminal and process

- exit: Ctrl+D on an empty draft, Ctrl+D with a draft, Ctrl+C at idle with a
  draft, SIGTERM/SIGINT mid-turn. Afterwards check the terminal is still usable:
  bracketed paste and kitty flags released, cursor visible, no live region left
  behind, final scrollback intact, exit code sane.
- geometry: at least 40x12, 80x24, 100x30, 200x50, plus 80x5, 80x2, 20x24, 5x24,
  1x1. Resize mid-stream, mid-tool, and while paused, narrow to wide and back.
  Run one session long enough that the live region re-anchors. Every geometry
  gets both a text capture and an image.
- scrollback integrity: exactly one blank row between blocks and never two in a
  row, nothing rewritten or lost, no orphan rows above the live region after a
  commit scrolls the pane, and copying a block out of the terminal yields the
  text without escape noise and without mistaking an elision marker for content.

# What to judge

Look at the images first and judge them as a product manager; the text captures
are there for precision once the image has raised a question.

- Can a first-time user tell what the agent is doing, what they typed, and what
  the agent did, at a glance?
- Are the states visually distinct, or do idle, paused, and streaming look the
  same? Does anything animate or move that shouldn't?
- Is interruption understandable — does the user know what Esc and Ctrl+C will
  do before pressing them, and what happened after?
- Is feedback timely (first visible response, spinner cadence, no silent stalls)
  and is the layout stable (does the editor jump)?
- Is the screen legible on a light theme and at narrow widths, and is noise
  (borders, prefixes, dim text) proportionate to the information it carries?

# Report

One file, `ux-walk-<date>.md`, in the repo root, with the captures referenced by
path.

- Coverage first: the state × geometry grid you actually ran, with the capture
  and the image for each cell. What you could not reach is a finding too — say
  so.
- Findings after, worst first. Each one: what the user was doing, the exact keys
  and timing, what appeared, what should have appeared instead, the image and the
  capture, the smallest reproducer, a severity (blocker / major / minor / nit),
  and whether it breaks a stated contract or is a taste call.
- Embed the images inline as markdown links
  (`![running bash](ux-walk-<date>/shots/running-bash.png)`) and quote the raw
  capture lines next to them rather than describing them. If something can't be
  shown in the report, attach the file.
- No fixes, no diffs, no proposals. One line naming what would fix a finding is
  the most you write.
