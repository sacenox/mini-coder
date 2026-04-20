# terminal-bench benchmark workspace

This directory contains Harbor wrappers and job output for benchmarking `mini-coder` on Terminal-Bench 2.0.

Everything here stays under `terminal-bench/` so benchmark work stays separate from production mini-coder code.

## Goal

- `mini_coder_agent.py` — leaderboard-style runs against published `mini-coder@latest`
- `mini_coder_local_agent.py` — local-checkout runs against the current mini-coder working tree
- model: `openai-codex/gpt-5.4`
- auth source: `~/.config/mini-coder/auth.json`
- settings source: `~/.config/mini-coder/settings.json`
- effort source: `~/.config/mini-coder/settings.json`

## Files

- `mini_coder_agent.py` — Harbor installed-agent wrapper for published `mini-coder@latest`
- `mini_coder_local_agent.py` — Harbor installed-agent wrapper for the current local checkout
- `jobs/` — Harbor job outputs
- `readme.md` — this runbook

## What each wrapper does

### `mini_coder_agent.py`

Per trial it:

1. installs system deps: `curl`, `unzip`, `ca-certificates`, `bash`, `git`, `python3`, `ripgrep`
2. installs Bun
3. installs published `mini-coder@latest`
4. finds the container user's home directory
5. uploads copies of:
   - `~/.config/mini-coder/settings.json`
   - `~/.config/mini-coder/auth.json`
6. runs:
   - `mc -p <task instruction>`
7. writes logs to:
   - `/logs/agent/mini-coder.ndjson`
   - `/logs/agent/mini-coder.stderr.txt`

### `mini_coder_local_agent.py`

Per trial it:

1. installs the same system deps and Bun bootstrap as `mini_coder_agent.py`
2. packages the current local checkout with `bun pm pack --ignore-scripts`
3. uploads that tarball into the Harbor environment
4. installs the tarball globally with Bun
5. uploads copies of:
   - `~/.config/mini-coder/settings.json`
   - `~/.config/mini-coder/auth.json`
6. runs:
   - `mc -p <task instruction>`
7. writes logs to:
   - `/logs/agent/mini-coder.ndjson`
   - `/logs/agent/mini-coder.stderr.txt`

## Requirements

Before running Harbor:

- `harbor` must be installed and on `PATH`
- local mini-coder auth must be valid
- local mini-coder settings must exist
- `bun` must be installed on the host for local-checkout runs

Quick checks:

```bash
command -v harbor
command -v bun
ls -l ~/.config/mini-coder/settings.json ~/.config/mini-coder/auth.json
npm view mini-coder version dist-tags --json
```

**WARNING** Don't be aggressive in running parallel evals because of rate limits.

## Verify the wrappers import

```bash
PYTHONPATH=$PWD/terminal-bench \
  ~/.local/share/pipx/venvs/harbor/bin/python -m py_compile \
  terminal-bench/mini_coder_agent.py \
  terminal-bench/mini_coder_local_agent.py
```

## Examples

### Fast consistency loop

Run the consistency check as 4 attempts and treat the result as `passes/4`:

```bash
PYTHONPATH=$PWD/terminal-bench harbor run -y \
  --job-name consistency-polyglot-rust-c-$(date +%F__%H-%M-%S) \
  --jobs-dir $PWD/terminal-bench/jobs \
  --agent-import-path mini_coder_agent:MiniCoderAgent \
  --model openai-codex/gpt-5.4 \
  --dataset terminal-bench@2.0 \
  --include-task-name polyglot-rust-c \
  --n-attempts 4 \
  --n-concurrent 1 \
  --max-retries 0
```

For local-checkout runs against the current working tree, use the same command but swap the agent import path:

```bash
PYTHONPATH=$PWD/terminal-bench harbor run -y \
  --job-name local-consistency-polyglot-rust-c-$(date +%F__%H-%M-%S) \
  --jobs-dir $PWD/terminal-bench/jobs \
  --agent-import-path mini_coder_local_agent:MiniCoderLocalAgent \
  --model openai-codex/gpt-5.4 \
  --dataset terminal-bench@2.0 \
  --include-task-name polyglot-rust-c \
  --n-attempts 4 \
  --n-concurrent 1 \
  --max-retries 0
```

See `TERMINALBENCH_README.md` for more information.
