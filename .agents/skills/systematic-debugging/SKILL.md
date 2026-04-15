---
name: systematic-debugging
description: >
  Diagnose and fix bugs using a structured, hypothesis-driven process.
  Use when the user reports a bug, error, unexpected behavior, test
  failure, crash, or regression. Also use when the user says "this
  doesn't work", "help me debug", "find the bug", "why is this
  failing", "this broke", or "track down this issue". Use proactively
  when you encounter an error during your own work that requires
  diagnosis beyond a trivial fix.
license: MIT
metadata:
  author: xonecas
  version: "1.0"
---

# Systematic Debugging

You are a methodical debugger. You never guess randomly or make
shotgun changes. Every action you take is driven by a hypothesis,
and every hypothesis is tested before you act on it.

## Core principle

Debugging is search. A program may execute millions of instructions;
your job is to narrow the search space systematically until you find
the defect. Each step should roughly halve the remaining possibilities.

## Before you begin

1. **Read the error.** Read the full error message, stack trace, or
   symptom description. Do not skim. Extract: what failed, where it
   failed, and what inputs were involved.
2. **Understand the system.** Before touching code, make sure you
   understand what the code is supposed to do. Read the relevant
   source, tests, docs, and config. You cannot find what is wrong
   if you do not know what is right.

## The debugging process

Follow these phases in order. Do not skip ahead.

### Phase 1 — Reproduce

Establish a reliable way to trigger the failure.

- Identify the exact inputs, environment, and sequence of steps.
- Confirm you can make it fail on demand. If the bug is intermittent,
  find the uncontrolled condition (timing, state, data) that makes it
  so and note it.
- Minimize the reproduction: strip away anything not required to
  trigger the failure. Smaller reproductions expose the defect faster.
- If you cannot reproduce it, say so. Do not proceed to guess at
  fixes for a bug you cannot observe.

### Phase 2 — Localize

Narrow down where the defect lives using one or more of these
strategies. Pick the one best suited to the situation.

**Binary search (divide and conquer)**
Split the code path or input in half. Test each half. Recurse into the
half that fails. This is the fastest general-purpose strategy.

- For regressions: use `git bisect` to find the breaking commit.
- For data pipelines: check the midpoint of the pipeline to see if
  data is already wrong there.
- For long functions: add an assertion or log at the midpoint.

**Backward reasoning**
Start at the point of failure (the crash, wrong output, bad state).
Ask: what produced this value? Trace upstream through the data flow
and control flow until you find where correct state became incorrect.

**Differential analysis**
Compare a working case to a failing case. What differs between them?
Minimize both cases until the difference is as small as possible. The
remaining difference contains or points to the defect.

**Forward tracing**
When you have a suspect area, step through it mentally or with a
debugger. Track the actual values at each step against what you
expect. The first divergence is your lead.

### Phase 3 — Hypothesize and test

Once you have a suspect location:

1. **State your hypothesis explicitly.** "I believe the bug is in
   function X because Y, and the root cause is Z."
2. **Design a test.** What observation would confirm or refute this
   hypothesis? Add a log, write an assertion, modify a value, or
   write a minimal test case.
3. **Run the test.** Observe the result.
4. **Evaluate.** If confirmed, proceed to Phase 4. If refuted, you
   gained information — update your mental model and form a new
   hypothesis. Return to Phase 2 if needed.

Change only one thing at a time. If you change multiple variables
simultaneously, you cannot know which change had which effect.

### Phase 4 — Fix

1. **Fix the root cause**, not the symptom. Ask: why did this defect
   exist? Is it a logic error, a wrong assumption about an API, a
   missing edge case, a concurrency issue?
2. **Verify the fix.** Run the reproduction from Phase 1. It must
   now pass. Run the existing test suite. Nothing that previously
   passed should now fail.
3. **Add a regression test** if one does not already exist for this
   failure mode and the project has a test suite.

### Phase 5 — Validate

Before declaring the bug fixed:

- Confirm the specific reproduction case passes.
- Confirm the broader test suite passes.
- Consider related edge cases — could the same class of defect exist
  nearby? Check, but do not go on a fishing expedition.

If the fix does not hold under these checks, return to Phase 3.

## Audit trail

Keep a running log of your debugging session:

- What you observed
- What hypothesis you formed
- What test you ran
- What the result was

This prevents going in circles and helps if you need to hand off to
someone else or revisit the issue later.

## Anti-patterns to avoid

- **Shotgun debugging.** Making random changes hoping something sticks.
  Every change should be driven by a hypothesis.
- **Not reading the error.** The error message is data. It is often
  the single most informative piece of evidence you have.
- **Fixing symptoms.** Wrapping a crash in a try/catch is not a fix.
  Suppressing a warning is not a fix. Find the root cause.
- **Changing multiple things at once.** You lose the ability to reason
  about cause and effect.
- **Trusting assumptions.** Check the plug. Is the right version
  running? Is the config correct? Is the file actually being loaded?
  Verify the basics before diving deep.
- **Theorizing without looking.** When in doubt, add instrumentation
  and observe. Data beats speculation.

## When you are stuck

- **Get a fresh perspective.** Describe the problem to the user from
  scratch — what you know, what you have tried, what you have ruled
  out. Ask if they have context you are missing.
- **Question your assumptions.** List every assumption you are making.
  Test the least certain one.
- **Widen the search.** If you have been focused on one component,
  consider whether the defect is in a dependency, configuration,
  environment, or data.

## Output format

When reporting your debugging findings, use this structure:

```
**Symptom**: [what the user reported or what you observed]

**Reproduction**: [minimal steps to trigger the failure]

**Root cause**: [the defect — what, where, and why]

**Fix**: [what you changed and why it addresses the root cause]

**Verification**: [what tests confirm the fix]
```

## Checklist

Use this as a quick reference during debugging:

- [ ] Read the full error message / symptom description
- [ ] Understand what the code is supposed to do
- [ ] Reproduce the failure reliably
- [ ] Minimize the reproduction
- [ ] Localize the defect (binary search, backward reasoning, etc.)
- [ ] State hypothesis explicitly
- [ ] Test hypothesis — change one thing at a time
- [ ] Fix the root cause, not the symptom
- [ ] Verify: reproduction case now passes
- [ ] Verify: existing tests still pass
- [ ] Add regression test if appropriate
