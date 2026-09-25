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
walk. This environment has **no `tmux`**: the pane *is* a kitty window, driven
through kitty's own remote control. Verified present: `kitty` 0.49.1,
`spectacle`, `script`, ImageMagick (`identify`/`convert`), `python3`. Not
installed: `tmux`, `xdotool`, `wmctrl`, `grim`, `slurp`. Wayland/KDE, display
2560x1440 at scale 1. The repo is `/mnt/storage/repos/mini-coder`; `node` v26.8.2
runs the TypeScript entrypoint directly.

- Launch one kitty instance per geometry, on a private socket, sized in cells
  before the app starts:

      kitty --detach --listen-on unix:/tmp/uxw-<date> \
        -o allow_remote_control=yes -o remember_window_size=no \
        -o initial_window_width=100c -o initial_window_height=30c \
        --title uxw-walk env PS1='\n$ ' bash --norc --noprofile -i

  Then `K() { kitty @ --to unix:/tmp/uxw-<date> "$@"; }` is the whole harness,
  and the window id comes from `K ls` — do not assume `id:1`. The app runs on the
  kitty pty itself, so `TERM=xterm-kitty`: a real terminal that emits SGR, enables
  bracketed paste, and answers the kitty keyboard flag the app requests.
- Geometry: `K resize-os-window -m id:N --action resize --unit cells --width W
  --height H` resizes the OS window in whole cells, and `K ls` reads the real grid
  back (`columns`/`lines` per window) — record that with every capture. Resizes
  below two cells are silently ignored, so 1x1 is reachable only by *launching*
  at that size (`initial_window_width=1c initial_window_height=1c`, verified);
  80x2, 5x24 and the rest resize fine. There is no status line, so window height
  is the pane height.
- Keys: `K send-text -m id:N 'literal'` (Python escapes: `\e`, `\n`, `\u21fa`)
  for literal text, `K send-key -m id:N <key>...` for named keys — `enter escape
  ctrl+c ctrl+d ctrl+a ctrl+e ctrl+w tab shift+tab up down home end ctrl+home
  ctrl+end alt+b ctrl+left ctrl+right delete bspace shift+enter`. The app enables
  kitty keyboard flag 1 and kitty answers the query itself, so `Shift+Enter`
  arrives as its own key; a terminal without the protocol sends the plain-Enter
  byte instead, which is reproduced exactly by writing that byte as text. Test
  both, since the plain byte is what most users' terminals do.
- Paste: `K send-text -m id:N` with the literal `ESC[200~` before the text and
  `ESC[201~` after it puts real bracketed-paste markers on the wire (verified
  byte-for-byte with `od`), one chunk per call — the replacement for tmux's
  `paste-buffer -p`. Build the argument with bash `$'...'` so the escapes stay
  literal; typing a newline without the markers is a different input path.
- Capture the pane, not the screen: `K get-text -m id:N --extent=all --ansi`
  keeps styling and includes the scrollback above the live region;
  `--extent=screen` is the live screen alone, `--add-cursor` appends the caret's
  exact cell (`ESC[?25h ESC[<row>;<col>H`), and `--add-wrap-markers` separates a
  soft wrap from a real newline. One capture per state, named
  `<state>-<geometry>-<step>.txt`; diffing captures between steps is how you see
  exactly what one keypress changed. A call costs ~25 ms, so a burst loop at
  50-80 ms catches the short-lived phases.
- Record one full session at the byte level with `script -q -f -O <run>/sNN.log
  -c 'node <repo>/src/cli.ts'` typed into the pane (`-f` flushes, so the log is
  readable while the app still runs). It is the only artifact showing the erase
  and redraw traffic the app actually emitted — where ghost rows, bad anchors, and
  duplicated scrollback show up — and it carries `ESC[?2004h ESC[>1u ESC[?u` on
  start, `ESC[<u ESC[?2004l` on stop, and `COMMAND_EXIT_CODE`, which is the exit
  code to quote.
- Keep everything the walk produces in one untracked run directory next to the
  report — `ux-walk-<date>/{captures,shots}/` plus the logs — and run every test
  session with that directory as mini-coder's cwd. `sessionsDir` **is** set in
  `~/.config/mini-coder/config.json` (`~/.local/state/mini-coder/sessions`), so
  sessions no longer land in the cwd; the run dir is still the right cwd because
  it keeps the model's own `bash`/`edit` calls out of the repo and because
  `<cwd>/AGENTS.md` is the only resource file read from the cwd (there is no
  walk-up), so the repo's `AGENTS.md` is not injected. Attribute the walk's
  sessions by the `cwd` field of each `session.jsonl` header and snapshot the
  directory before and after: the 28 pre-existing dirs must not change.
  - The persistence-failure path is reached by making the *configured* directory
    unwritable — `chmod 500 ~/.local/state/mini-coder/sessions`, submit, then
    `chmod 700` — not by changing config. It crashes out of `Session.ensure`
    without running the app's terminal teardown, so the terminal check after it
    matters.
- No config changes, no flags. Afterwards confirm the repo is untouched: the
  previous walk's artifacts are now tracked, so the new run dir is the one
  untracked entry in `git status --short`.
- Images are required, not a nicety: they are what the walk is judged on.
  `K screenshot -m id:N <run>/shots/<state>.png` has kitty write a PNG of its own
  surface — no window focus needed, no window decoration, and it does include the
  text cursor (verified). Cross-check the states where the composited view matters
  with `spectacle -a -b -n -o <run>/shots/<state>.png`: it grabs the focused OS
  window with title bar and shadows, so the kitty window must be the active one
  (verified on this Wayland/KDE session). If a window grab keeps missing, take
  `spectacle -f -b -n -o full.png` and crop with `convert -crop WxH+X+Y`.
  - Never assume the geometry: read it back from `K ls` and record it next to the
    image, and record the measured cell size too (default font here: 9x20 px, so
    100x30 → 900x600 px), since font, scale and padding all move it. Size the
    terminal yourself (`initial_window_width=100c initial_window_height=30c`) so
    runs are comparable.
  - Verify every shot before moving on: `identify` it and look at it. A
    screenshot of the wrong window, a stale frame, or a half-drawn pane is worse
    than no screenshot, because it goes into the report as evidence.
  - Cover what a pixel grab uniquely shows: light theme and dark theme, cursor
    visibility and position, the spinner frame, dim versus normal intensity, wide
    characters and emoji, wrapped-token edges, and colors that text captures
    flatten into escapes. Switch the host theme in place with `K set-colors -a
    background=#ffffff foreground=#000000 cursor=#000000`; the app paints its own
    palette, so the light-theme check is that no row leaks the host's colours.
- Use the provider and model already configured in `~/.config/mini-coder`
  (`opencode-go/deepseek-v4.1-flash`, effective effort `high`), with short
  single-purpose prompts — one prompt per state you want to reach — so streaming,
  reasoning, tool calls, and usage numbers are all genuine. Reach the hostile
  shapes through the model too: ask it to run a command that prints a few hundred
  lines, to edit a file large enough to show a full diff, to read an image, to run
  something slow enough to catch mid-tool phases, or to write a long reply so you
  can interrupt it mid-stream. Two states this configuration cannot reach, to be
  reported as not covered rather than faked: the `read` of an image on a model
  that does *not* accept image input (this model declares image input, so the
  other case needs a different provider/model), and a provider error or stalled
  stream. Note also that the config default effort is `medium`, but this model's
  `thinkingLevelMap` marks `minimal`, `medium`, and `xhigh` as `null` — only
  `low`, `high`, and `max` are supported — so the app clamps the default up to
  `high`: the request carries `reasoning_effort: "high"` and the startup banner
  reads `... · high`. The dimmed reasoning preview appears only for prompts that
  make the model think.
- Hazard: with a live turn, the model's own `bash` tool can reach this pane
  (`kitty @ --to unix:/tmp/uxw-<date> send-key ...`), so prompts must be
  self-contained, and the pane must be re-read rather than assumed to hold still.

# States to walk

Derive the list from the code rather than trusting this file, but the walk is not
done until every one of these has been reached and captured:

Startup and idle

- banner `mini-coder · <provider>/<model> · <effective thinking effort>`, empty
  scrollback, status row showing only the context readout, cursor at column 0 of
  the editor.
- editor: empty draft, one line wrapping past the width, more lines than the
  viewport, caret at each wrap boundary (read it with `--add-cursor`), Home/End,
  Ctrl+A/Ctrl+E, Ctrl+Home/Ctrl+End, word motions, backspace/delete across a line
  join, Ctrl+W at line start, Tab on a non-command draft, paste of multi-line text
  and of a fence.
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
  `! <tool error>`; plus the persistence failure path (unwritable `sessionsDir`),
  which must stop the turn.

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
  behind, final scrollback intact, exit code sane (the `script` log records
  `COMMAND_EXIT_CODE`).
- geometry: at least 40x12, 80x24, 100x30, 200x50, plus 80x5, 80x2, 20x24, 5x24,
  1x1 (1x1 needs a fresh launch; kitty refuses sub-two-cell resizes). Resize
  mid-stream, mid-tool, and while paused, narrow to wide and back. Run one session
  long enough that the live region re-anchors. Every geometry gets both a text
  capture and an image.
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
