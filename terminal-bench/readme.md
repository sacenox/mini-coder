# terminal-bench benchmark workspace

This directory contains the Harbor wrapper and job output for benchmarking published `mini-coder` on Terminal-Bench 2.0.

Everything here stays under `terminal-bench/` so benchmark work stays separate from production mini-coder code.

## Goal

Run Terminal-Bench tasks against published `mini-coder@latest` with Harbor, using the current local mini-coder config:

- model: `openai-codex/gpt-5.4`
- auth source: `~/.config/mini-coder/auth.json`
- settings source: `~/.config/mini-coder/settings.json`
- effort source: `~/.config/mini-coder/settings.json`

At the time of writing, `npm view mini-coder version dist-tags --json` reports `latest = 0.5.1`.

## Files

- `mini_coder_agent.py` — Harbor installed-agent wrapper for mini-coder
- `jobs/` — Harbor job outputs
- `readme.md` — this runbook

## What the wrapper does

`mini_coder_agent.py` does this per trial:

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

## Requirements

Before running Harbor:

- `harbor` must be installed and on `PATH`
- local mini-coder auth must be valid
- local mini-coder settings must exist

Quick checks:

```bash
command -v harbor
ls -l ~/.config/mini-coder/settings.json ~/.config/mini-coder/auth.json
npm view mini-coder version dist-tags --json
```

## Verify the wrapper imports

```bash
PYTHONPATH=$PWD/terminal-bench \
  ~/.local/share/pipx/venvs/harbor/bin/python -m py_compile \
  terminal-bench/mini_coder_agent.py
```

## Recommended runs

Run these two easy tasks first. They are the recommended smoke tests before trying slower tasks.

### 1. `fix-git`

Recommended first run.

```bash
PYTHONPATH=$PWD/terminal-bench harbor run -y \
  -d terminal-bench@2.0 \
  --agent-import-path mini_coder_agent:MiniCoderAgent \
  -m openai-codex/gpt-5.4 \
  -i fix-git -l 1 \
  -k 1 -n 1 \
  -o terminal-bench/jobs
```

### 2. `prove-plus-comm`

Recommended alternate easy run.

```bash
PYTHONPATH=$PWD/terminal-bench harbor run -y \
  -d terminal-bench@2.0 \
  --agent-import-path mini_coder_agent:MiniCoderAgent \
  -m openai-codex/gpt-5.4 \
  -i prove-plus-comm -l 1 \
  -k 1 -n 1 \
  -o terminal-bench/jobs
```

### Generic one-task command

```bash
PYTHONPATH=$PWD/terminal-bench harbor run -y \
  -d terminal-bench@2.0 \
  --agent-import-path mini_coder_agent:MiniCoderAgent \
  -m openai-codex/gpt-5.4 \
  -i <task-id> -l 1 \
  -k 1 -n 1 \
  -o terminal-bench/jobs
```

## Inspecting results

### Show the latest Harbor job tree

```bash
JOB=$(ls -dt terminal-bench/jobs/* | head -n1)
find "$JOB" -maxdepth 4 -type f | sort
```

### Show the latest top-level result summary

```bash
JOB=$(ls -dt terminal-bench/jobs/* | head -n1)
sed -n '1,220p' "$JOB"/result.json
```

### Show verifier output from the latest trial

```bash
JOB=$(ls -dt terminal-bench/jobs/* | head -n1)
sed -n '1,220p' "$JOB"/*/verifier/test-stdout.txt
sed -n '1,40p' "$JOB"/*/verifier/reward.txt
```

### Show mini-coder logs from the latest trial

```bash
JOB=$(ls -dt terminal-bench/jobs/* | head -n1)
sed -n '1,160p' "$JOB"/*/agent/mini-coder.stderr.txt
sed -n '1,160p' "$JOB"/*/agent/mini-coder.ndjson
```

### Show the latest trial exception, if any

```bash
JOB=$(ls -dt terminal-bench/jobs/* | head -n1)
sed -n '1,220p' "$JOB"/*/exception.txt
```

## Notes

- The wrapper benchmarks the published package, not the local checkout.
- The wrapper copies host mini-coder auth/settings into the container; it does not mount or mutate the host files.
- The task image supplies task-specific toolchains. The wrapper only adds generic helpers like `git`, `python3`, and `ripgrep`.
- For leaderboard-comparable runs, do **not** change timeouts or resources.
- If `openai-codex` auth expires, ask the user to refresh it locally with mini-coder before rerunning.
