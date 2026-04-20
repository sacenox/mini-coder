# CORE GOAL

**Terminal-Bench is a signal, not the product. The target is a better coding agent, not a higher benchmark score from benchmark-shaped patches.**

- Do not add fixes to fix an issue with specific terminal bench evals, focus on improving the agent's behaviour.
- Benchmarks run headless mode in one shot. Make sure you use `tmux` often to check that the TUI and multiturn UX is still
  good.

# Benchmark workflow

Use this as the default tuning loop for `mini-coder` on Terminal-Bench.

The goal is not to rerun the whole benchmark after every change. The goal is to get fast enough feedback that small changes can be judged quickly, then promote only the promising ones to bigger runs.

## Principles

- Keep changes small.
- Change one thing at a time.
- Compare against a fresh baseline, not an old leaderboard run.
- Use fast suites for iteration, broad suites for promotion.
- Keep structured `mc --json` logs in trial artifacts so behavior can be analyzed.
- Optimize for general coding-agent behavior first.
- Use benchmark failures to extract general behavior gaps, not to encode benchmark lore into the agent.
- Prefer generic improvements over task-named patches, reminders, or stop-time nudges.

## Suites

There is a full 89 test baseline run with 2 attemps in the teminal-bench folder. Use the evals in it
to determine your fast evals to start your optimization process and iterations.

Settings:

- `2` attempts
- `2` concurrent
- `0` retries

## Experiment quality bar

Before changing code, write the hypothesis in two layers:

1. the benchmark symptom
2. the general coding-agent behavior gap behind it

Only run an experiment if you can answer all of these:

- what general behavior is being improved?
- why should that help outside Terminal-Bench?
- what would make this change obviously overfit?

Reject or redesign experiments that:

- depend on benchmark-specific task names, file names, package names, or tool names in product logic
- inject reminders or guards keyed to one benchmark noun unless that rule maps cleanly to a real product behavior
- only make sense because a particular verifier is known
- cannot be explained without citing a single task transcript

Hard rule:

- no task-specific nouns in agent logic unless they map to a real product feature

## Iteration loop

For each change:

1. inspect the last fast / focused failures
2. translate them into **one** general behavior gap
3. reject benchmark-shaped ideas; if you cannot phrase the change without task-specific nouns, keep diagnosing
4. if the change depends on a dynamic trigger, confirm that the trigger actually appears in the target failures
5. form **one** narrow hypothesis
6. make **one** small change
7. run:
   - fast suite
8. compare to baseline or your reference run
9. decide:
   - keep
   - revert
   - refine

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

## Minimal experiment log format

You are running in a loop, make sure to keep your progress tracked so you
can continue between loop iterations, this is to avoid context pressure.:w
Keep this in `PROGRESS.md`, a final summary for each completed change:

- benchmark symptom
- general behavior gap
- why this should help outside Terminal-Bench
- hypothesis
- verification method
- keep / revert / refine (Make the decision very visible in the file).
