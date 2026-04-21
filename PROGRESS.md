# CURRENT TASK PROGRESS

## Baseline

- Full baseline completed from `terminal-bench/jobs/benchmark-baseline-full-2026-04-19__12-30-08`.
- Trial result: `126/178` passed.
- Task split: `53/89` passed both attempts, `20/89` split attempts, `16/89` failed both attempts.

## Fast suite for the next iteration

Use these as the first local one-attempt loop before any broader rerun:

- `configure-git-webserver` — failed both attempts, ~195s avg
- `large-scale-text-editing` — failed both attempts, ~205s avg
- `gcode-to-text` — failed both attempts, ~322s avg

## Completed step: baseline analysis

- benchmark symptom:
  - `configure-git-webserver` did real work but left a reusable script instead of the live configured end state; verifier got HTTP 000.
  - `large-scale-text-editing` produced the transformed data but still missed the exact artifact contract the verifier checked.
  - `gcode-to-text` spent the full turn analyzing the geometry and never wrote the required output file before the session died.
- general behavior gap:
  - mini-coder is not end-state / contract driven enough in one-shot tasks. It over-invests in reusable artifacts and open-ended analysis instead of finishing the exact requested state and explicit deliverables first.
- why this should help outside Terminal-Bench:
  - real users also want the current repo/environment fixed now, not a helper script, a near-equivalent artifact, or a long unfinished investigation.
- hypothesis:
  - bias the agent toward the smallest direct completion path, and make it re-check the exact requested deliverables / end state before optional packaging, docs, or extra tooling.
- verification method:
  - make one small product change, then run a one-attempt local fast suite on the three tasks above with `mc --json` logs kept for behavior review.
- DECISION:
  - KEEP — use this fast suite and hypothesis for the next implementation loop.

## Completed step: end-state prompt reinforcement

- change made:
  - tightened the core system prompt so the agent explicitly prefers the smallest path that leaves the requested end state already true, and re-checks named deliverables before finishing.
- benchmark symptom:
  - the fast-suite failures were still consistent with “close enough” completion: helper scripts instead of the live state, implied contract satisfaction instead of the exact artifact, and long analysis before writing the requested file.
- general behavior gap:
  - even with strong existing instructions, mini-coder still too easily treats mechanism-building or likely-equivalent output as completion when the task really wants the current environment or explicit deliverable to already be correct.
- why this should help outside Terminal-Bench:
  - this is normal user behavior too: if they ask for `/app/out.txt`, a running service on a port, or an exact file/script shape, they want that state now, not just a way to get there later.
- hypothesis:
  - a small prompt reinforcement around live end state + explicit deliverable re-checks will push one-shot runs toward direct completion without adding task-specific product logic.
- verification method:
  - product checks: `bun test src/prompt.test.ts`, `bun run typecheck`, `bun test`, `bun run check`, `bun run format`
  - benchmark check: one-attempt local fast suite in `terminal-bench/jobs/fast-end-state-check-2026-04-20__22-30-43`
- result summary:
  - fast suite improved from `0/3` to `1/3`
  - `large-scale-text-editing` passed; the agent now preserved the exact three-macro artifact contract instead of collapsing it to an equivalent shorter script.
  - `gcode-to-text` improved materially; it wrote `/app/out.txt` and finished cleanly, but decoded one character wrong (`1` instead of `i`).
  - `configure-git-webserver` improved partially; it left a live server instead of HTTP 000, but still finished with HTTP 404 because the deployed content was not actually present at verifier time.
- DECISION:
  - KEEP — this looks like a real general behavior improvement, not benchmark-shaped overfitting, and it already fixed one fast-suite task outright while moving the other two closer to completion.

## Completed step: contradiction / ambiguity prompt reinforcement

- change made:
  - tightened the core system prompt again so the agent explicitly trusts contradictory tool evidence, avoids guessing between plausible outputs/end states, and verifies again after any later state change.
- benchmark symptom:
  - `configure-git-webserver` was close but still lost the verifier because the agent talked itself into a cleaner final state after successful local verification.
  - `gcode-to-text` was down to one ambiguous character, so the remaining problem looked like unresolved uncertainty rather than missing effort.
- general behavior gap:
  - mini-coder can still let speculative cleanup or a plausible guess override concrete evidence. When it has multiple believable interpretations, it does not always force a small discriminating check before finalizing.
- why this should help outside Terminal-Bench:
  - this is a normal coding-agent failure mode too: users need the agent to trust the actual test output and settle ambiguous file contents, ports, or command results with one more check instead of narrating past the contradiction.
- hypothesis:
  - a small prompt reinforcement around evidence-over-narrative and ambiguity resolution will make one-shot runs hold onto verified success states and avoid avoidable guesses.
- verification method:
  - product checks: `bun test src/prompt.test.ts`, `bun run typecheck`, `bun test`, `bun run check`, `bun run format`
  - benchmark check: one-attempt local fast suite in `terminal-bench/jobs/fast-ambiguity-check-2026-04-20__22-45-36`
- result summary:
  - fast suite improved from `1/3` to `2/3`
  - `configure-git-webserver` now passes end-to-end; the agent kept the verified deployed state instead of reverting to an empty-but-cleaner repo state.
  - `large-scale-text-editing` stayed green.
  - `gcode-to-text` did not produce a comparable behavioral result because the run hit a `NonZeroAgentExitCodeError` after several `readImage` calls on generated PNGs; the provider rejected one image as invalid before the agent could finish.
- DECISION:
  - KEEP — this change appears to have produced another real behavior win, and the remaining fast-suite failure now points at a separate product bug in the headless/readImage path rather than a clear rejection of the hypothesis.
