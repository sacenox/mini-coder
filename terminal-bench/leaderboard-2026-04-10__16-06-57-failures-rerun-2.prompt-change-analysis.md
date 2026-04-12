# Leaderboard failures rerun analysis

This report compares:

- original leaderboard run: `terminal-bench/jobs/leaderboard-2026-04-10__16-06-57`
- failure rerun: `terminal-bench/jobs/leaderboard-2026-04-10__16-06-57-failures-rerun-2`

Data sources used:

- each trial `result.json`
- verifier `ctrf.json` and `test-stdout.txt`
- agent logs in `agent/mini-coder.ndjson`

## Executive summary

This rerun covered **29 tasks that had failed in the original leaderboard run**.

Outcome on the rerun set:

- **12 now pass**
- **16 still fail**
- **1 timed out before verifier completion** (`video-processing`)

The fail -> pass tasks are:

- `adaptive-rejection-sampler`
- `dna-insert`
- `extract-elf`
- `largest-eigenval`
- `llm-inference-batching-scheduler`
- `mailman`
- `overfull-hbox`
- `polyglot-c-py`
- `polyglot-rust-c`
- `qemu-alpine-ssh`
- `torch-tensor-parallelism`
- `tune-mjcf`

The improvement is real. The strongest signal is that **two tasks now pass even though the agent still timed out**:

- `mailman`
- `tune-mjcf`

That means the required artifact was already good enough before the run ended. This matches the intended prompt change: produce the required output earlier instead of saving it for late in the run.

## What improved

## 1. More tasks now cross the verifier line

Several tasks moved from obvious near-miss territory to clean pass territory:

| task                               | original           | rerun                           |
| ---------------------------------- | ------------------ | ------------------------------- |
| `llm-inference-batching-scheduler` | 1/6 tests, timeout | 6/6 tests, pass                 |
| `polyglot-rust-c`                  | 0/1 tests, timeout | 1/1 tests, pass                 |
| `qemu-alpine-ssh`                  | 0/1 tests, timeout | 1/1 tests, pass                 |
| `mailman`                          | 1/3 tests, timeout | 3/3 tests, pass despite timeout |
| `tune-mjcf`                        | 3/4 tests, timeout | 4/4 tests, pass despite timeout |
| `adaptive-rejection-sampler`       | 8/9 tests          | 9/9 tests                       |
| `extract-elf`                      | 1/2 tests          | 2/2 tests                       |
| `largest-eigenval`                 | 2/3 tests          | 3/3 tests                       |
| `torch-tensor-parallelism`         | 2/3 tests          | 3/3 tests                       |
| `overfull-hbox`                    | 3/4 tests          | 4/4 tests                       |

This is not just a small shift in average behavior. Multiple tasks crossed from partial verifier progress to full pass.

## 2. The agent appears to verify a bit more, and earlier

Using a rough heuristic over shell commands, the rerun subset shows more verifier/test-like shell usage:

- original rerun-subset baseline: **8** test/verifier-like shell calls
- rerun: **18** test/verifier-like shell calls

Within the rerun itself, the passing tasks also look more verifier-oriented than the still-failing tasks:

- tasks that improved to pass: **0.92** test-like shell calls on average
- tasks that still failed: **0.41** test-like shell calls on average

This is only a heuristic, but it lines up with the visible task outcomes: more of the successful runs found the verifier boundary and iterated against it.

## 3. Some runs now create a passing artifact before the timeout wall

The clearest evidence is again `mailman` and `tune-mjcf`, which both still ended with `AgentTimeoutError` but now score `1.0`.

That is exactly the failure mode the prompt change was meant to attack: runs that do enough good work to pass, but only if the required artifact lands before the timeout.

## Tool awkwardness: what changed

## `edit`

`edit` no longer looks like a major source of friction.

Across the 29-task rerun subset:

- **79** edit calls total
- only **2** edit errors total

Those two edit errors were straightforward exact-match failures:

- `caffe-cifar-10` — old text matched multiple locations
- `install-windows-3.11` — old text not found

Important contrast with the original run: the earlier internal `edit` crash seen in `gpt2-codegolf` (`undefined is not an object`) did **not** reappear here.

Conclusion: from the agent's perspective, `edit` is mostly behaving cleanly now.

## `shell`

Raw non-zero shell exits are almost unchanged:

- original rerun-subset baseline: **68** non-zero shell results
- rerun: **67** non-zero shell results

So the improvement is **not** “the agent suddenly stopped making shell mistakes”. The more useful change is in the type of shell awkwardness.

### The earlier `printf` compatibility issue appears fixed

The original run contained several `printf: Illegal option --` failures in agent-authored shell commands.

I found those in the original logs, including `mailman`, `query-optimize`, and other tasks. I found **no occurrences** of that issue in the rerun logs.

That is a direct positive signal for the shell compatibility normalization work.

### The remaining shell awkwardness is mostly environment assumptions

The recurring shell failures in the rerun are dominated by assumptions about available binaries rather than mini-coder shell semantics.

Recurring examples in the rerun subset:

- `python` not found — **8 tasks**
- `file` not found — **4 tasks**
- `No module named pip` — **3 tasks**
- `/usr/bin/time` not found — **2 tasks**
- `g++` not found — **2 tasks**

Tasks hit by `python` not found:

- `dna-assembly`
- `dna-insert`
- `extract-moves-from-video`
- `mcmc-sampling-stan`
- `overfull-hbox`
- `qemu-alpine-ssh`
- `torch-pipeline-parallelism`
- `torch-tensor-parallelism`

This matters because some of these tasks still passed anyway. So these failures are real friction, but they are not the same class as the earlier shell-tool conflict. The agent is still making environment assumptions, but mini-coder itself is less obviously fighting the agent.

## Remaining failures: how they still fail

## A. Timed out without producing the required artifact

These are still the clearest contract-first misses.

| task                       | rerun verifier       | main failure signal                  |
| -------------------------- | -------------------- | ------------------------------------ |
| `crack-7z-hash`            | 0/2                  | `/app/solution.txt` missing          |
| `db-wal-recovery`          | 0/7                  | `/app/recovered.json` missing        |
| `extract-moves-from-video` | 0/2                  | `/app/solution.txt` missing          |
| `make-doom-for-mips`       | 0/3                  | `/tmp/frame.bmp` missing             |
| `video-processing`         | verifier not reached | timed out before verifier completion |

This is still the biggest remaining bucket of lost score.

## B. Timed out with partial progress, but not enough to pass

These runs clearly did real work, but did not land on the exact contract in time.

| task                   | rerun verifier | main failure signal                                          |
| ---------------------- | -------------- | ------------------------------------------------------------ |
| `caffe-cifar-10`       | 3/6            | `caffe.bin` missing; solver not set to CPU mode              |
| `install-windows-3.11` | 2/4            | no VGA config; keyboard/F1 monitor interaction still failing |
| `train-fasttext`       | 0/2            | accuracy too low and model too large                         |

`caffe-cifar-10` is especially worth noting: it improved from “timeout before verifier signal” in the original run to **3/6 passing tests** in the rerun, so it is clearly closer, but still not there.

## C. Near misses: one bad detail blocks an otherwise strong run

These are the rerun failures that already look close to passing.

| task                         | rerun verifier | main failure signal                                           |
| ---------------------------- | -------------- | ------------------------------------------------------------- |
| `headless-terminal`          | 6/7            | interactive path breaks inside `pyte` on private SGR handling |
| `mcmc-sampling-stan`         | 5/6            | expected sampling log/messages missing                        |
| `make-mips-interpreter`      | 2/3            | output image similarity 0.8456, needs 0.95                    |
| `torch-pipeline-parallelism` | 2/3            | backward mismatch in one layer/microbatch                     |

These are not broad failures. They are verifier-focused misses on one remaining edge or correctness detail.

## D. Wrong solution shape or algorithm mismatch

These failures do not look tool-related. They look like the agent produced the wrong implementation or the wrong tradeoff.

| task                  | rerun verifier | main failure signal                                      |
| --------------------- | -------------- | -------------------------------------------------------- |
| `dna-assembly`        | 0/1            | primer constraints wrong                                 |
| `filter-js-from-html` | 0/2            | still misses many XSS cases and also modifies clean HTML |
| `gpt2-codegolf`       | 0/1            | wrong output                                             |
| `raman-fitting`       | 1/3            | fitted peaks are materially wrong                        |
| `sam-cell-seg`        | 1/9            | run script fails; expected output CSV missing            |

`filter-js-from-html` is the clearest example here. The rerun log shows a lot of detailed work and many tool calls, but the verifier still reports both:

- the sanitizer misses large classes of attack vectors
- the sanitizer changes clean HTML that should remain unchanged

That is a solution-fit issue, not a tool-usage issue.

## Regressions and unstable cases

Not everything improved.

A few tasks got worse, or at least less stable:

| task                   | original  | rerun                         |
| ---------------------- | --------- | ----------------------------- |
| `db-wal-recovery`      | 5/7 tests | 0/7 tests, timeout            |
| `install-windows-3.11` | 3/4 tests | 2/4 tests                     |
| `video-processing`     | 4/5 tests | verifier not reached, timeout |

A few others stayed stuck at roughly the same near-miss level:

- `headless-terminal` — 6/7 -> 6/7
- `make-mips-interpreter` — 2/3 -> 2/3
- `torch-pipeline-parallelism` — 2/3 -> 2/3
- `raman-fitting` — 1/3 -> 1/3
- `sam-cell-seg` — 1/9 -> 1/9

So the gains are real, but they are not universal.

## Overall conclusion

The rerun supports the main hypothesis behind the recent prompt and tool work:

- the agent is more likely to produce the required output early enough to matter
- the agent is a bit more likely to discover verifier boundaries and iterate against them
- the earlier `printf` shell awkwardness looks gone
- `edit` now looks low-friction most of the time

The remaining misses are now less about mini-coder fighting the agent, and more about three buckets:

1. still timing out before writing the exact required artifact
2. near-miss implementations with one remaining verifier-visible defect
3. environment assumptions in shell usage (`python`, `file`, `pip`, `g++`, `/usr/bin/time`)

That is a healthier failure profile than the original run.

## Ranked narrow changes to discuss next

These are ranked discussion candidates, based on the rerun data above.

1. **Add a narrow shell compatibility rewrite from `python` -> `python3` when `python` is absent and the rewrite is unambiguous.**
   - Why this ranks first: `python`-missing shell failures appeared in **8 rerun tasks**, including some otherwise strong runs. This is a narrow, repeated, machine-fixable pattern.

2. **Add an explicit prompt rule to probe tool availability before assuming non-core binaries exist.**
   - Example pattern: `command -v file`, `command -v g++`, `command -v python3`, `python3 -m pip --version`.
   - Why: the rerun still shows repeated assumptions about `file`, `pip`, `g++`, and `/usr/bin/time`.

3. **Strengthen the prompt rule that if the task names a required output path, the agent should create that exact artifact early, then iterate.**
   - Why: the biggest remaining zero-score failures still end with missing required files like `/app/solution.txt`, `/app/recovered.json`, or `/tmp/frame.bmp`.

4. **Strengthen the prompt rule to run the narrowest verifier or test as soon as there is a plausible first artifact, instead of delaying the first verifier run.**
   - Why: the improved tasks correlate with more verifier-like shell usage, and many remaining failures still look under-verified until late.

5. **Add a prompt rule for near-miss mode: once most tests are passing, stop broad exploration and focus only on the failing assertions.**
   - Why: several rerun failures are already at 5/6, 6/7, or 2/3 and look like they lost time to broader work instead of concentrating on the final failing detail.
