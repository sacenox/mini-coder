# Benchmark workflow

Use this as the default tuning loop for `mini-coder` on Terminal-Bench.

The goal is not to rerun the whole benchmark after every change. The goal is to get fast enough feedback that small prompt / loop / tool-use changes can be judged quickly, then promote only the promising ones to bigger runs.

## Principles

- Keep changes small.
- Change one thing at a time.
- Compare against a fresh baseline, not an old leaderboard run.
- Use fast suites for iteration, broad suites for promotion.
- Keep structured `mc --json` logs in trial artifacts so behavior can be analyzed.

## Suites

### 1. Guardrail suite

Use this to catch regressions on known-good behavior.

Tasks:
- `cancel-async-tasks`
- `bn-fit-modify`
- `sparql-university`
- `extract-elf`

Settings:
- `1` attempt
- `2` concurrent
- `0` retries

Estimated wall time:
- about `8–10 minutes`

### 2. Fast suite

Use this after almost every small change.

Tasks:
- `polyglot-rust-c`
- `overfull-hbox`
- `gcode-to-text`
- `mteb-retrieve`
- `dna-insert`
- `torch-tensor-parallelism`

Settings:
- `2` attempts
- `2` concurrent
- `0` retries

Estimated wall time:
- about `44 minutes`

### 3. Focused suite

Use this only if a change looks good on the fast suite.

Tasks:
- `polyglot-rust-c`
- `overfull-hbox`
- `gcode-to-text`
- `mteb-retrieve`
- `torch-tensor-parallelism`
- `filter-js-from-html`
- `configure-git-webserver`
- `qemu-alpine-ssh`

Settings:
- `2` attempts
- `2` concurrent
- `0` retries

Estimated wall time:
- about `1.1 hours`

### 4. Broad promotion suite

Use this after 1–3 promising changes, or overnight.

Options:
- rerun recent failures
- wider local failure suite
- full leaderboard-style run

Typical settings for rerunning recent failures:
- `4` attempts
- `2` concurrent
- `0` retries

## Baseline procedure

Before changing code:

1. run the guardrail suite
2. run the fast suite
3. run the fast suite again

That gives a fresh local baseline for:
- pass count
- runtime
- variance / noise

Do not compare a new change only against an old run from days ago if a fresh same-HEAD baseline is available.

## Iteration loop

For each change:

1. inspect the last fast / focused failures
2. pick **one** failure pattern
3. form **one** narrow hypothesis
4. make **one** small change
5. run:
   - guardrails
   - fast suite
6. compare to baseline
7. decide:
   - keep
   - revert
   - refine

Only run the focused suite if:
- the fast suite improved, and
- the guardrails did not regress

Only run the broad promotion suite if:
- the focused suite also looks good, or
- enough promising changes have accumulated to justify it

## Decision rules

Treat the fast suite as a noisy but useful signal.

For the 12-trial fast suite:
- `+2` or more passes: probably meaningful improvement
- `-2` or more passes: probably meaningful regression
- `±1`: likely noise unless it repeats

Keep a change if:
- the fast suite improves materially
- guardrails do not regress
- the result repeats on another fast-suite rerun

Revert a change if:
- it clearly loses fast-suite passes, or
- it regresses guardrails

Call it inconclusive if:
- the delta is tiny and does not repeat

## Failure buckets to optimize against

Use these as the main buckets when inspecting logs:

### Exact-contract / cleanup misses
Examples:
- right artifact, wrong path
- right output plus extra junk
- correct core work, but violates a strict file / in-place requirement

### Didn’t verify early enough
Examples:
- waited too long to run a test
- never checked the exact contract
- kept exploring before the first meaningful verification

### Over-exploration / shell thrash
Examples:
- too many shell / read steps before first write
- repeated discovery commands without narrowing the problem

### Persistent correctness gaps
Examples:
- `torch-tensor-parallelism`
- `filter-js-from-html`
- `configure-git-webserver`

### Long-horizon / timeout-heavy tasks
These are useful for promotion runs, not tight inner loops.
Examples:
- `gpt2-codegolf`
- `query-optimize`
- `winning-avg-corewars`
- `train-fasttext`

## Behavior analysis requirements

Behavior analysis depends on structured agent logs.

Keep wrappers on:
- `mc --json -p ...`

Per trial, keep:
- result JSON
- verifier output
- exception type
- agent stderr
- structured `agent/mini-coder.ndjson`
- timestamps

With those artifacts, analyze things like:
- time to first tool call
- time to first edit
- number of `shell` / `read` / `grep` / `edit` calls
- whether the agent ran a verifier-like shell command
- whether it had a local pass before ending
- whether it kept changing files after a pass-worthy state
- whether it left extra artifacts

## Recommended first optimization targets

Start with:
1. exact-contract and stopping discipline
2. earlier verification
3. less wandering during discovery
4. loop nudges that reduce shell thrash without adding a hard step cap

## Commands

### Guardrail suite

```bash
GUARDRAIL_TASKS=(
  cancel-async-tasks
  bn-fit-modify
  sparql-university
  extract-elf
)

cmd=(
  harbor run -y
  --job-name local-guardrails-$(date +%F__%H-%M-%S)
  --jobs-dir "$PWD/terminal-bench/jobs"
  --agent-import-path mini_coder_local_agent:MiniCoderLocalAgent
  --model openai-codex/gpt-5.4
  --dataset terminal-bench@2.0
  --n-attempts 1
  --n-concurrent 2
  --max-retries 0
)

for t in "${GUARDRAIL_TASKS[@]}"; do
  cmd+=(--include-task-name "$t")
done

PYTHONPATH="$PWD/terminal-bench" "${cmd[@]}"
```

### Fast suite

```bash
FAST_TASKS=(
  polyglot-rust-c
  overfull-hbox
  gcode-to-text
  mteb-retrieve
  dna-insert
  torch-tensor-parallelism
)

cmd=(
  harbor run -y
  --job-name local-fast-$(date +%F__%H-%M-%S)
  --jobs-dir "$PWD/terminal-bench/jobs"
  --agent-import-path mini_coder_local_agent:MiniCoderLocalAgent
  --model openai-codex/gpt-5.4
  --dataset terminal-bench@2.0
  --n-attempts 2
  --n-concurrent 2
  --max-retries 0
)

for t in "${FAST_TASKS[@]}"; do
  cmd+=(--include-task-name "$t")
done

PYTHONPATH="$PWD/terminal-bench" "${cmd[@]}"
```

### Focused suite

```bash
FOCUS_TASKS=(
  polyglot-rust-c
  overfull-hbox
  gcode-to-text
  mteb-retrieve
  torch-tensor-parallelism
  filter-js-from-html
  configure-git-webserver
  qemu-alpine-ssh
)

cmd=(
  harbor run -y
  --job-name local-focus-$(date +%F__%H-%M-%S)
  --jobs-dir "$PWD/terminal-bench/jobs"
  --agent-import-path mini_coder_local_agent:MiniCoderLocalAgent
  --model openai-codex/gpt-5.4
  --dataset terminal-bench@2.0
  --n-attempts 2
  --n-concurrent 2
  --max-retries 0
)

for t in "${FOCUS_TASKS[@]}"; do
  cmd+=(--include-task-name "$t")
done

PYTHONPATH="$PWD/terminal-bench" "${cmd[@]}"
```

## Session-start prompt

In a new session, the quickest way to start is:

- read `BENCHMARK.md`
- run the guardrail suite
- run the fast suite twice for baseline
- inspect failures and grouped behavior patterns
- propose one small hypothesis and one small change

## Minimal experiment log format

Keep this in the session or in the final summary for each change:

- hypothesis
- files changed
- guardrail result
- fast-suite result
- focused-suite result, if run
- keep / revert / refine
