/**
 * First-class delegated-subagent tool.
 *
 * @module
 */

import type { Static, Tool } from "@mariozechner/pi-ai";
import { Type } from "@mariozechner/pi-ai";
import type { ToolHandler, ToolUpdateCallback } from "./agent.ts";
import {
  reserveToolDelegation,
  type ShellDelegationContext,
} from "./delegation.ts";
import { textResult, validateBuiltinToolArgs } from "./tool-common.ts";

const delegateToolParameters = Type.Object({
  task: Type.String({
    description:
      "Bounded subtask prompt for the delegated subagent. Include the specific goal, constraints, and expected deliverable.",
  }),
});

/** Arguments for the `delegate` tool. */
export type DelegateArgs = Static<typeof delegateToolParameters>;

/** Structured details preserved on a persisted `delegate` tool result. */
export interface DelegateResultDetails {
  /** How the delegated subagent run ended. */
  stopReason: "stop" | "length" | "error" | "aborted";
}

/** Summarized output returned from one delegated subagent run. */
export interface DelegateRunResult {
  /** How the delegated subagent run ended. */
  stopReason: DelegateResultDetails["stopReason"];
  /** Final assistant text emitted by the subagent. */
  finalText: string;
  /** Terminal assistant error text when the subagent failed. */
  errorText: string | null;
}

/** pi-ai tool definition for `delegate`. */
export const delegateTool: Tool<typeof delegateToolParameters> = {
  name: "delegate",
  description:
    "Run a bounded subtask in an isolated subagent session using the current model, prompt context, and tools. " +
    "Use this when a focused second agent pass will help, and prefer it over shelling out to `mc -p` unless you are explicitly testing the CLI itself.",
  parameters: delegateToolParameters,
};

/** Options for a `delegate` handler that enforces delegation safeguards. */
export interface CreateDelegateToolHandlerOpts {
  /** Return the current subagent-delegation context for the active run. */
  getDelegationContext: () => ShellDelegationContext;
  /** Persist the updated delegation context after a launch reservation. */
  setDelegationContext: (context: ShellDelegationContext) => void;
  /** Execute one delegated subagent run. */
  runSubagent: (
    task: string,
    context: ShellDelegationContext,
    signal?: AbortSignal,
    onUpdate?: ToolUpdateCallback,
  ) => Promise<DelegateRunResult>;
}

/**
 * Format the model-visible text payload returned from a delegated subagent run.
 *
 * @param result - Delegated subagent result.
 * @returns Text content suitable for the parent tool result.
 */
export function formatDelegateResultText(result: DelegateRunResult): string {
  const lines = [`Subagent stop reason: ${result.stopReason}`];

  if (result.finalText.length > 0) {
    lines.push("", "Final answer:", result.finalText);
  } else {
    lines.push("", "Final answer:", "(no final text)");
  }

  if (result.errorText) {
    lines.push("", "Terminal error:", result.errorText);
  }

  return lines.join("\n");
}

/**
 * Create a `delegate` tool handler that enforces delegation limits.
 *
 * @param opts - Delegation-context accessors plus the delegated-run executor.
 * @returns A tool handler for first-class delegated subagent runs.
 */
export function createDelegateToolHandler(
  opts: CreateDelegateToolHandlerOpts,
): ToolHandler {
  return async (args, _cwd, signal, onUpdate) => {
    const validatedArgs = validateBuiltinToolArgs(delegateTool, args);
    const reservation = reserveToolDelegation(opts.getDelegationContext());
    if (!reservation.ok) {
      return textResult(reservation.error, true);
    }

    opts.setDelegationContext(reservation.reservation.updatedContext);
    const result = await opts.runSubagent(
      validatedArgs.task,
      reservation.reservation.childContext,
      signal,
      onUpdate,
    );

    return {
      content: [
        {
          type: "text",
          text: formatDelegateResultText(result),
        },
      ],
      details: {
        stopReason: result.stopReason,
      } satisfies DelegateResultDetails,
      isError: result.stopReason === "error" || result.stopReason === "aborted",
    };
  };
}
