/**
 * Subagent delegation safeguards.
 *
 * Tracks a shallow delegation depth plus a small per-run delegation budget so
 * first-class `delegate` tool runs and shell-authored `mc -p` child processes
 * cannot recurse forever.
 *
 * @module
 */

const SHELL_DELEGATION_COMMAND =
  /(?:^|[;&|()\s])(?:[^\s;&|()]+\/)?mc\s+(?:-p\b|--prompt(?:\b|=))/g;

/** Environment variable carrying the current subagent-delegation depth. */
export const SHELL_DELEGATION_DEPTH_ENV = "MC_SUBAGENT_DEPTH";

/** Environment variable carrying the remaining subagent-delegation budget. */
export const SHELL_DELEGATION_BUDGET_ENV = "MC_SUBAGENT_BUDGET";

/** Maximum allowed subagent delegation depth. */
export const MAX_SHELL_DELEGATION_DEPTH = 1;

/** Default number of delegated subagent launches allowed per agent run. */
export const DEFAULT_SHELL_DELEGATION_BUDGET = 4;

/** Current subagent-delegation context for one app run. */
export interface ShellDelegationContext {
  /** Current subagent-delegation depth for this app process. */
  depth: number;
  /** Remaining delegated-subagent launches available in the active run. */
  remainingBudget: number;
}

/** Result of reserving subagent-delegation budget for one launch. */
export interface ShellDelegationReservation {
  /** Number of delegated-subagent launches reserved by the request. */
  launchCount: number;
  /** Updated parent-run context after reserving any delegated launches. */
  updatedContext: ShellDelegationContext;
  /** Context that delegated child runs should inherit for this request. */
  childContext: ShellDelegationContext;
}

/** Successful or blocked delegation-reservation outcome. */
export type ReserveShellDelegationResult =
  | {
      /** Whether the delegation request may proceed. */
      ok: true;
      /** Reserved delegation details for the request. */
      reservation: ShellDelegationReservation;
    }
  | {
      /** Whether the delegation request may proceed. */
      ok: false;
      /** Human-readable tool error for the blocked delegation attempt. */
      error: string;
    };

type DelegationReservationError = "nested" | "exhausted" | "over_budget";

function readNonNegativeInteger(
  value: string | undefined,
  fallback: number,
): number {
  if (value == null || value === "") {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function reserveDelegationBudget(
  context: ShellDelegationContext,
  launchCount: number,
):
  | {
      ok: true;
      reservation: ShellDelegationReservation;
    }
  | {
      ok: false;
      reason: DelegationReservationError;
    } {
  if (launchCount === 0) {
    const unchanged = { ...context };
    return {
      ok: true,
      reservation: {
        launchCount,
        updatedContext: unchanged,
        childContext: unchanged,
      },
    };
  }

  if (context.depth >= MAX_SHELL_DELEGATION_DEPTH) {
    return {
      ok: false,
      reason: "nested",
    };
  }

  if (context.remainingBudget === 0) {
    return {
      ok: false,
      reason: "exhausted",
    };
  }

  if (launchCount > context.remainingBudget) {
    return {
      ok: false,
      reason: "over_budget",
    };
  }

  const remainingBudget = context.remainingBudget - launchCount;
  return {
    ok: true,
    reservation: {
      launchCount,
      updatedContext: {
        depth: context.depth,
        remainingBudget,
      },
      childContext: {
        depth: context.depth + 1,
        remainingBudget,
      },
    },
  };
}

/**
 * Read the current subagent-delegation context from environment variables.
 *
 * Missing or invalid values fall back to the safe root-run defaults.
 *
 * @param env - Environment variables to inspect.
 * @returns The parsed subagent-delegation context.
 */
export function readShellDelegationContext(
  env: Readonly<Record<string, string | undefined>>,
): ShellDelegationContext {
  return {
    depth: readNonNegativeInteger(env[SHELL_DELEGATION_DEPTH_ENV], 0),
    remainingBudget: readNonNegativeInteger(
      env[SHELL_DELEGATION_BUDGET_ENV],
      DEFAULT_SHELL_DELEGATION_BUDGET,
    ),
  };
}

/**
 * Build the environment-variable overrides for a subagent-delegation context.
 *
 * @param context - Subagent-delegation context to serialize.
 * @returns Environment overrides for child shell processes.
 */
export function buildShellDelegationEnv(
  context: ShellDelegationContext,
): Record<string, string> {
  return {
    [SHELL_DELEGATION_DEPTH_ENV]: String(context.depth),
    [SHELL_DELEGATION_BUDGET_ENV]: String(context.remainingBudget),
  };
}

/**
 * Count likely shell-authored `mc -p` / `mc --prompt` launches in one command.
 *
 * The detector is intentionally narrow and optimized for the prompt-guided
 * `mc -p "subtask"` pattern mini-coder still supports for CLI-level testing.
 *
 * @param command - Raw shell command.
 * @returns Number of likely `mc -p` launches in the command.
 */
export function countShellDelegationLaunches(command: string): number {
  return command.match(SHELL_DELEGATION_COMMAND)?.length ?? 0;
}

/**
 * Reserve first-class `delegate` tool budget for one delegated subagent run.
 *
 * @param context - Current subagent-delegation context for the active run.
 * @returns Reservation details, or a blocking error when this delegation would
 *          exceed the allowed subagent-delegation policy.
 */
export function reserveToolDelegation(
  context: ShellDelegationContext,
): ReserveShellDelegationResult {
  const reservation = reserveDelegationBudget(context, 1);
  if (!reservation.ok) {
    return {
      ok: false,
      error:
        reservation.reason === "nested"
          ? "Tool delegation blocked: delegated `delegate` tool runs may not delegate again."
          : "Tool delegation blocked: this run has no remaining `delegate` delegation budget.",
    };
  }

  return reservation;
}

/**
 * Reserve shell-level delegation budget for a command before execution.
 *
 * Non-delegating commands pass through unchanged. Commands that would exceed
 * the per-run delegation budget or the maximum allowed depth are rejected with
 * a user-visible tool error.
 *
 * @param command - Raw shell command to inspect.
 * @param context - Current subagent-delegation context for the active run.
 * @returns Reservation details, or a blocking error when the command would
 *          exceed the allowed shell-level delegation policy.
 */
export function reserveShellDelegation(
  command: string,
  context: ShellDelegationContext,
): ReserveShellDelegationResult {
  const launchCount = countShellDelegationLaunches(command);
  const reservation = reserveDelegationBudget(context, launchCount);
  if (!reservation.ok) {
    return {
      ok: false,
      error:
        reservation.reason === "nested"
          ? "Shell delegation blocked: delegated `mc -p` runs may not launch more `mc -p` subagents."
          : reservation.reason === "exhausted"
            ? "Shell delegation blocked: this run has no remaining `mc -p` delegation budget."
            : "Shell delegation blocked: this command appears to launch more `mc -p` subagents than the remaining delegation budget allows.",
    };
  }

  return reservation;
}
