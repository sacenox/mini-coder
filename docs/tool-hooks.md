# Tool Hooks

A tool hook is an executable script that runs automatically after a specific tool call succeeds. Use hooks to trigger side effects — linting, formatting, logging, notifications — without modifying the agent's behaviour.

> Hooks fire **after** the tool succeeds. Failures are silently swallowed and never crash the agent.

## Where to put them

Hooks live in a `hooks/` folder inside an `.agents` config root:

| Location | Scope |
|---|---|
| `.agents/hooks/post-<tool>` | Current repo only |
| `~/.agents/hooks/post-<tool>` | All projects (global) |

Local hooks take precedence over global ones. The filename must match `post-<tool>` exactly — no extension.

## Supported tools

| Tool | Hook filename |
|---|---|
| `read` | `post-read` |
| `create` | `post-create` |
| `shell` | `post-shell` |

MCP tools are not hookable.

For partial edits, the agent now prefers shell commands that invoke `mc-edit`, so those operations are observed through `post-shell`.

## Script requirements

The script must be executable (`chmod +x`). It can be written in any language — bash, Python, Node, etc. It receives context via environment variables and its exit code is reported in the UI (zero = success, non-zero = failure).

## Environment variables

All hooks receive:

| Variable | Description |
|---|---|
| `TOOL` | Name of the tool that fired |
| `CWD` | Working directory of the session |

Plus tool-specific variables:

### `post-create`

| Variable | Description |
|---|---|
| `FILEPATH` | Absolute path of the file written |
| `DIFF` | Unified diff of the change |
| `CREATED` | `true` if the file was newly created, `false` if overwritten |

### `post-shell`

| Variable | Description |
|---|---|
| `COMMAND` | The shell command that was run |
| `EXIT_CODE` | Exit code of the command |
| `TIMED_OUT` | `true` if the command timed out |
| `STDOUT` | Captured standard output |
| `STDERR` | Captured standard error |

### `post-read`

| Variable | Description |
|---|---|
| `FILEPATH` | Absolute path of the file read |

## Examples

### Auto-format on create/overwrite

`.agents/hooks/post-create`:

```bash
#!/usr/bin/env bash
# Run the project formatter whenever the agent creates or overwrites a file.
bun run format -- "$FILEPATH"
```

```bash
chmod +x .agents/hooks/post-create
```

### Log every shell command

`~/.agents/hooks/post-shell`:

```bash
#!/usr/bin/env bash
# Append a record of every shell command to a global audit log.
echo "$(date -u +%FT%TZ)  exit=$EXIT_CODE  $COMMAND" >> ~/.config/mini-coder/shell-audit.log
```

```bash
chmod +x ~/.agents/hooks/post-shell
```

### Notify on `mc-edit` usage

`.agents/hooks/post-shell`:

```bash
#!/usr/bin/env bash
case "$COMMAND" in
  *mc-edit*)
    osascript -e "display notification \"$COMMAND\" with title \"mini-coder ran mc-edit\""
    ;;
esac
```

## Hook lookup

Hooks are resolved once at session start and cached in memory — there is no filesystem access per tool call. Changing a hook script takes effect on the next session.
