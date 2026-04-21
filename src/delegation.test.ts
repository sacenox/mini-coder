import { describe, expect, test } from "bun:test";
import {
  buildShellDelegationEnv,
  countShellDelegationLaunches,
  DEFAULT_SHELL_DELEGATION_BUDGET,
  readShellDelegationContext,
  reserveShellDelegation,
  reserveToolDelegation,
} from "./delegation.ts";

describe("shell delegation safeguards", () => {
  test("reads the default root delegation context when env is unset", () => {
    expect(readShellDelegationContext({})).toEqual({
      depth: 0,
      remainingBudget: DEFAULT_SHELL_DELEGATION_BUDGET,
    });
  });

  test("serializes the delegation context back into shell env vars", () => {
    expect(
      buildShellDelegationEnv({
        depth: 1,
        remainingBudget: 2,
      }),
    ).toEqual({
      MC_SUBAGENT_DEPTH: "1",
      MC_SUBAGENT_BUDGET: "2",
    });
  });

  test("counts likely mc -p launches in supported shell command shapes", () => {
    expect(countShellDelegationLaunches('mc -p "review the diff"')).toBe(1);
    expect(
      countShellDelegationLaunches('command -v mc && mc -p "review the diff"'),
    ).toBe(1);
    expect(
      countShellDelegationLaunches(
        'bun /home/xonecas/.bun/bin/mc -p "review the diff"',
      ),
    ).toBe(1);
    expect(
      countShellDelegationLaunches(
        'printf "mc -p should stay literal, not execute"',
      ),
    ).toBe(0);
  });

  test("reserving a root shell delegation decrements the remaining budget", () => {
    const result = reserveShellDelegation('mc -p "review the diff"', {
      depth: 0,
      remainingBudget: 3,
    });

    expect(result).toEqual({
      ok: true,
      reservation: {
        launchCount: 1,
        updatedContext: {
          depth: 0,
          remainingBudget: 2,
        },
        childContext: {
          depth: 1,
          remainingBudget: 2,
        },
      },
    });
  });

  test("reserving a root delegate tool call decrements the remaining budget", () => {
    const result = reserveToolDelegation({
      depth: 0,
      remainingBudget: 3,
    });

    expect(result).toEqual({
      ok: true,
      reservation: {
        launchCount: 1,
        updatedContext: {
          depth: 0,
          remainingBudget: 2,
        },
        childContext: {
          depth: 1,
          remainingBudget: 2,
        },
      },
    });
  });

  test("blocks nested delegated children from launching more mc -p subagents", () => {
    expect(
      reserveShellDelegation('mc -p "review again"', {
        depth: 1,
        remainingBudget: 3,
      }),
    ).toEqual({
      ok: false,
      error:
        "Shell delegation blocked: delegated `mc -p` runs may not launch more `mc -p` subagents.",
    });
  });

  test("blocks commands that exceed the remaining shell delegation budget", () => {
    expect(
      reserveShellDelegation('mc -p "one" && mc -p "two"', {
        depth: 0,
        remainingBudget: 1,
      }),
    ).toEqual({
      ok: false,
      error:
        "Shell delegation blocked: this command appears to launch more `mc -p` subagents than the remaining delegation budget allows.",
    });
  });

  test("blocks delegate tool calls when no delegation budget remains", () => {
    expect(
      reserveToolDelegation({
        depth: 0,
        remainingBudget: 0,
      }),
    ).toEqual({
      ok: false,
      error:
        "Tool delegation blocked: this run has no remaining `delegate` delegation budget.",
    });
  });

  test("blocks nested delegated children from calling delegate again", () => {
    expect(
      reserveToolDelegation({
        depth: 1,
        remainingBudget: 3,
      }),
    ).toEqual({
      ok: false,
      error:
        "Tool delegation blocked: delegated `delegate` tool runs may not delegate again.",
    });
  });

  test("leaves non-delegating shell commands unchanged", () => {
    const result = reserveShellDelegation("bun test src/headless.test.ts", {
      depth: 0,
      remainingBudget: 4,
    });

    expect(result).toEqual({
      ok: true,
      reservation: {
        launchCount: 0,
        updatedContext: {
          depth: 0,
          remainingBudget: 4,
        },
        childContext: {
          depth: 0,
          remainingBudget: 4,
        },
      },
    });
  });
});
