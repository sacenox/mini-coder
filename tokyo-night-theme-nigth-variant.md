# Theme: Tokyo Night, Night variant

## Current state

mini-coder has one palette and it is dark, but only the syntax highlighting
carries any of it, and it carries the wrong variant: the hexes in
`src/tui/highlight.ts` are Tokyo Night **moon**, not **night**. No palette
definition exists outside that file.

Everything the TUI itself writes — banner, status row, `> ` echo, ` | ` and
` ! ` body prefixes, `-> ` call lines, `[complete · Ns]`, `! cancelled`,
`! <error>`, `/help` — is styled with the terminal's default foreground (ANSI
30–37, or `SGR 2` on top of it) and no background at all. So on a light
terminal the chrome is unreadable and the moon tokens wash out; on a dark one
the screen is only half in Tokyo Night. The ux-walk recorded it as finding 5:
`ux-walk-20260924/ux-walk-20260924.md`, shots
`ux-walk-20260924/shots/s10-light-{idle,tools,markdown}-100x30-0{1,2,3}.png`.

## Source of truth

https://github.com/folke/tokyonight.nvim we use the **Night** variant as the
default.

## Verification

Repeat the exact same test that saw this issue in ux-walk and assert that both syntax highlight looks correct on dark background even if the terminal is set to light mode.

# Goals:

- Fix the theme pallete so it's accurate to folke's night variant.
- Ensure the app's foreground and background consistently use the theme's colors, and
no terminal defaults are visible inside mini-coder.
