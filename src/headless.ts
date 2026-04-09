/**
 * Headless one-shot execution.
 *
 * @module
 */

import type { AppState } from "./index.ts";
import {
  resolveRawInput,
  type SubmitTurnHooks,
  submitResolvedInput,
} from "./submit.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Options for a headless one-shot run. */
export interface HeadlessRunOptions {
  /** Optional line writer for NDJSON event output. */
  writeLine?: (line: string) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function defaultWriteLine(line: string): void {
  process.stdout.write(`${line}\n`);
}

function isBrokenPipeError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (("code" in error && error.code === "EPIPE") ||
      ("message" in error &&
        typeof error.message === "string" &&
        error.message.includes("broken pipe")))
  );
}

function createSigintHandler(state: AppState): () => void {
  return () => {
    state.abortController?.abort();
  };
}

function buildCommandError(command: string): Error {
  return new Error(
    `Headless mode does not support slash commands: /${command}`,
  );
}

/**
 * Run a single headless prompt to completion and stream NDJSON events.
 *
 * The raw input is parsed with the same rules as interactive input. Slash
 * commands are rejected in headless mode. Assistant/tool events are written as
 * one JSON object per line.
 *
 * @param state - Mutable application state for the run.
 * @param rawInput - Exact raw prompt text supplied by the user.
 * @param options - Optional event-output overrides.
 * @returns The terminal stop reason for the agent loop.
 */
export async function runHeadlessPrompt(
  state: AppState,
  rawInput: string,
  options?: HeadlessRunOptions,
): Promise<"stop" | "length" | "error" | "aborted"> {
  const resolved = resolveRawInput(rawInput, state);
  switch (resolved.type) {
    case "empty":
      throw new Error("Headless input is empty.");
    case "error":
      throw new Error(resolved.message);
    case "command":
      throw buildCommandError(resolved.command);
    case "message":
      break;
  }

  let brokenPipe = false;
  let outputError: unknown = null;
  const stopForBrokenPipe = (): void => {
    if (brokenPipe) {
      return;
    }
    brokenPipe = true;
    state.abortController?.abort();
  };
  const writeLineImpl = options?.writeLine ?? defaultWriteLine;
  const writeLine = (line: string): void => {
    if (brokenPipe) {
      return;
    }

    try {
      writeLineImpl(line);
    } catch (error) {
      if (!isBrokenPipeError(error)) {
        throw error;
      }
      stopForBrokenPipe();
    }
  };
  const hooks: SubmitTurnHooks = {
    onEvent: (event) => {
      writeLine(JSON.stringify(event));
    },
  };
  const sigintHandler = createSigintHandler(state);
  const stdoutErrorHandler = (error: unknown): void => {
    if (isBrokenPipeError(error)) {
      stopForBrokenPipe();
      return;
    }
    outputError = error;
    state.abortController?.abort();
  };

  process.stdout.on("error", stdoutErrorHandler);
  process.on("SIGINT", sigintHandler);
  try {
    const stopReason = await submitResolvedInput(
      rawInput,
      resolved.content,
      state,
      hooks,
    );
    if (outputError) {
      throw outputError;
    }
    return brokenPipe ? "stop" : stopReason;
  } finally {
    process.stdout.off("error", stdoutErrorHandler);
    process.off("SIGINT", sigintHandler);
  }
}
