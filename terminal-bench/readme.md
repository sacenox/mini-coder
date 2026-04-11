# terminal-bench benchmark workspace

This directory contains Harbor wrappers and job output for benchmarking `mini-coder` on Terminal-Bench 2.0.

Everything here stays under `terminal-bench/` so benchmark work stays separate from production mini-coder code.

## Goal

Keep two workflows side by side:

- `mini_coder_agent.py` — leaderboard-style runs against published `mini-coder@latest`
- `mini_coder_local_agent.py` — pre-commit runs against the current local packaged checkout

Both wrappers use the current local mini-coder config:

- model: `openai-codex/gpt-5.4`
- auth source: `~/.config/mini-coder/auth.json`
- settings source: `~/.config/mini-coder/settings.json`
- effort source: `~/.config/mini-coder/settings.json`

At the time of writing, `npm view mini-coder version dist-tags --json` reports `latest = 0.5.2`.

## Files

- `mini_coder_agent.py` — Harbor installed-agent wrapper for published `mini-coder@latest`
- `mini_coder_local_agent.py` — Harbor installed-agent wrapper for the current local packaged checkout
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

1. installs the same system deps and Bun
2. runs `bun pm pack --ignore-scripts` on the current repo checkout on the host
3. uploads that tarball into the Harbor container
4. installs `mini-coder` from the uploaded tarball
5. uploads host copies of `settings.json` and `auth.json`
6. runs:
   - `mc -p <task instruction>`
7. writes logs to:
   - `/logs/agent/mini-coder.ndjson`
   - `/logs/agent/mini-coder.stderr.txt`

Use the local wrapper when you want Terminal-Bench signal on the current diff before committing. Use the published wrapper for leaderboard-comparable runs.

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

## Verify the wrappers import

```bash
PYTHONPATH=$PWD/terminal-bench \
  ~/.local/share/pipx/venvs/harbor/bin/python -m py_compile \
  terminal-bench/mini_coder_agent.py \
  terminal-bench/mini_coder_local_agent.py
```

## Recommended smoke runs

Run these easy tasks first before slower tasks.

### Published `@latest`: `fix-git`

```bash
PYTHONPATH=$PWD/terminal-bench harbor run -y \
  -d terminal-bench@2.0 \
  --agent-import-path mini_coder_agent:MiniCoderAgent \
  -m openai-codex/gpt-5.4 \
  -i fix-git -l 1 \
  -k 1 -n 1 \
  -o terminal-bench/jobs
```

### Published `@latest`: `prove-plus-comm`

```bash
PYTHONPATH=$PWD/terminal-bench harbor run -y \
  -d terminal-bench@2.0 \
  --agent-import-path mini_coder_agent:MiniCoderAgent \
  -m openai-codex/gpt-5.4 \
  -i prove-plus-comm -l 1 \
  -k 1 -n 1 \
  -o terminal-bench/jobs
```

### Current local checkout: `fix-git`

```bash
PYTHONPATH=$PWD/terminal-bench harbor run -y \
  -d terminal-bench@2.0 \
  --agent-import-path mini_coder_local_agent:MiniCoderLocalAgent \
  -m openai-codex/gpt-5.4 \
  -i fix-git -l 1 \
  -k 1 -n 1 \
  -o terminal-bench/jobs
```

### Current local checkout: generic one-task command

```bash
PYTHONPATH=$PWD/terminal-bench harbor run -y \
  -d terminal-bench@2.0 \
  --agent-import-path mini_coder_local_agent:MiniCoderLocalAgent \
  -m openai-codex/gpt-5.4 \
  -i <task-id> -l 1 \
  -k 1 -n 1 \
  -o terminal-bench/jobs
```

If you want to keep published and local-checkout jobs separate, use different `-o` directories.

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

## Current benchmark context

Latest full leaderboard-style run kept for inspection:

- `terminal-bench/jobs/leaderboard-2026-04-10__16-06-57`
- score: about **67.4%**
- pattern: many failures were near misses; the biggest buckets were exact-contract misses and runs that explored too long before writing the required artifact

Working lessons for the next runs:

- Read machine-checkable acceptance criteria early: `/tests`, verifier scripts, eval scripts, examples, expected-output files.
- Identify the exact contract up front: required file paths, names, signatures, stdout/output shape, and forbidden extra artifacts.
- Create the required artifact early, then iterate. Some timed-out runs can still pass if the file is already correct enough.
- Prefer the smallest verifier-passing solution over a broader or more impressive implementation.
- Before stopping, run a targeted exactness check: required files exist, names/signatures match, output format matches, and no extra artifacts were left behind.

Prompt changes prepared after reviewing this run:

- base prompt now emphasizes contract-first execution, early verifier/test discovery, early artifact creation, minimal passing solutions, and exact final verification
- `shell` tool description now explicitly points the agent toward tests/verifiers/examples and required outputs
- `edit` tool description now explicitly frames the tool as writing the exact final file content the task requires

Important:

- `mini_coder_agent.py` benchmarks the published npm package
- `mini_coder_local_agent.py` benchmarks whatever `bun pm pack --ignore-scripts` would install from the current local checkout

## Notes

- Both wrappers copy host mini-coder auth/settings into the container; they do not mount or mutate the host files.
- The task image supplies task-specific toolchains. The wrappers only add generic helpers like `git`, `python3`, and `ripgrep`.
- For leaderboard-comparable runs, keep using `mini_coder_agent.py` and do **not** change timeouts or resources.
- If `openai-codex` auth expires, ask the user to refresh it locally with mini-coder before rerunning.
