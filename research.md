I want your help exploring how could we use yoctocolor to add color ouput to commonly used shell commands. Let's first check the db, check the recent past sessions for a sample. Then check for the shell usage and assert the most common commands

Response:

## Shell Usage Analysis (from 101 sessions)

Most common commands:
| Command | Count | Opportunity |
|---------|-------|-------------|
| `cat` | 72 | File content preview |
| `git` | 54 | Status/diff output |
| `bun` | 32 | Test/build output |
| `sed` | 29 | Transform preview |
| `mc-edit` | 26 | File edits |
| `nl` | 12 | Line numbers |
| `rg` | 11 | Search matches |
| `npm` | 9 | Package output |
| `grep` | 7 | Match highlighting |
| `ls` | 5 | File listings |

## Current Shell Output Coloring (in `tool-result-renderers.ts`)

The shell result renderer already uses yoctocolors:

- **Status badges**: `c.green("done")` / `c.red("error")` / `c.yellow("timeout")`
- **Stderr lines**: `c.red()` for error emphasis
- **Stdout/stderr line separators**: `c.dim()` or colored pipe character

## Enhancement Opportunities

1. **Command syntax highlighting** - Color `git`, `bun`, `npm` commands differently in the tool call line
2. **File path highlighting** - Use `c.cyan()` for paths in output
3. **Git diffs from mc-edit** - Render a colored diff
4. **Line numbers** - `nl` output could use `c.yellow()` for numbers
5. **Git output** - Branch names in `c.cyan()`, commit hashes in `c.yellow()`, file statuses (M/A/D) in color
6. **rg/grep matches** - Highlight matching text in `c.greenBright()` or `c.yellow()`
7. **Exit code** - Non-zero codes in `c.red()` or `c.yellow()`
8. **Test output** - `bun test` results: passes in `c.green()`, fails in `c.red()`, skips in `c.yellow()`
