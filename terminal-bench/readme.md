# terminal-bench benchmark workspace

This folder is the scratch space for benchmarking mini-coder against Terminal-Bench 2.0 with Harbor.

Everything here is intentionally kept under `terminal-bench/` so it does it's separate from production code.

## Goal

Benchmark published `mini-coder@latest` on Terminal-Bench 2.0 using Harbor, with the current local mini-coder config:

- model: `openai-codex/gpt-5.4`
- effort: `xhigh`
- auth source: `~/.config/mini-coder/auth.json`
- settings source: `~/.config/mini-coder/settings.json`

## Key decisions

1. **Use Harbor's custom installed-agent path**
   - Harbor does not require multiple models.
   - We use a custom installed agent instead of changing mini-coder core behavior.

2. **Benchmark published mini-coder, not the local checkout**
   - The wrapper installs `mini-coder@latest` inside the task container.
   - This was the chosen path instead of packaging the current repo state.

3. **Use the current mini-coder OAuth config**
   - `openai-codex` in mini-coder is OAuth-backed.
   - The wrapper copies the local `auth.json` and `settings.json` into the container.
   - It uploads copies only; it does **not** mount or mutate the host files.

4. **Keep the integration outside the product code**
   - The Harbor agent lives here in `mini_coder_agent.py`.
   - No tracked repo files were changed for the benchmark setup.

## Files

- `mini_coder_agent.py` — Harbor installed-agent wrapper for mini-coder
- `jobs/` — Harbor job outputs from smoke runs

## Current wrapper behavior

`mini_coder_agent.py` does this per trial:

1. installs system deps: `curl`, `unzip`, `ca-certificates`, `bash`, `git`
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

## Progress so far

### Smoke run 1

Command:

```bash
PYTHONPATH=$PWD/terminal-bench harbor run -y \
  -d terminal-bench@2.0 \
  --agent-import-path mini_coder_agent:MiniCoderAgent \
  -m openai-codex/gpt-5.4 \
  -l 1 -k 1 -n 1 \
  -o terminal-bench/jobs
```

Job dir:

- `jobs/2026-04-09__22-14-57`

Result:

- failed immediately before the agent really started
- root cause: `git` was missing in the task container
- mini-coder stderr contained:

```text
Executable not found in $PATH: "git"
```

Fix applied afterward:

- updated the wrapper install step to include `git`

### Smoke run 2

Same command after the `git` fix.

Job dir:

- `jobs/2026-04-09__22-17-21`

Result:

- the run got past startup
- mini-coder emitted headless NDJSON thinking output
- Harbor job was interrupted/cancelled before completion
- Harbor recorded a `CancelledError`

Evidence:

- `jobs/2026-04-09__22-17-21/*/agent/mini-coder.ndjson` contains streamed model output
- `jobs/2026-04-09__22-17-21/*/exception.txt` shows cancellation

## Current status

The wrapper is past the first blocker (`git` missing) and is capable of launching mini-coder inside the Harbor task container.

The next real checkpoint is to rerun the same 1-task smoke test and let it finish.

## Resume commands

### Verify the wrapper still imports

```bash
PYTHONPATH=$PWD/terminal-bench \
  ~/.local/share/pipx/venvs/harbor/bin/python -m py_compile \
  terminal-bench/mini_coder_agent.py
```

### Run the 1-task smoke test again

```bash
PYTHONPATH=$PWD/terminal-bench harbor run -y \
  -d terminal-bench@2.0 \
  --agent-import-path mini_coder_agent:MiniCoderAgent \
  -m openai-codex/gpt-5.4 \
  -l 1 -k 1 -n 1 \
  -o terminal-bench/jobs
```

### Inspect the latest Harbor job

```bash
JOB=$(ls -dt terminal-bench/jobs/* | head -n1)
find "$JOB" -maxdepth 3 -type f | sort
```

### Inspect mini-coder logs from the latest trial

```bash
JOB=$(ls -dt terminal-bench/jobs/* | head -n1)
sed -n '1,120p' "$JOB"/*/agent/mini-coder.stderr.txt
sed -n '1,120p' "$JOB"/*/agent/mini-coder.ndjson
```

## Known constraints / notes

- This setup depends on the host mini-coder OAuth/login state being current.
- If `openai-codex` auth expires, refresh it locally with mini-coder before rerunning.
- Because the wrapper copies the host config into the container, the host auth/settings files are not modified by Harbor.
- The first two smoke jobs are kept intentionally for debugging history.

## Next step

Rerun the same 1-task smoke test and let it complete. If that passes the launch phase cleanly, decide whether to:

1. keep iterating with `-l 1 -k 1`
2. run a small subset
3. run a larger TB2 batch later
