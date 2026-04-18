/**
 * Headless one-shot execution.
 *
 * @module
 */

import type { AssistantMessage, UserMessage } from "@mariozechner/pi-ai";
import type { AgentEvent } from "./agent.ts";
import type { AppState } from "./index.ts";
import {
  resolveRawInput,
  type SubmitTurnHooks,
  submitResolvedInput,
} from "./submit.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type HeadlessStopReason = "stop" | "length" | "error" | "aborted";

/** Options for a headless NDJSON run. */
export interface HeadlessRunOptions {
  /** Optional line writer for completed NDJSON event output. */
  writeLine?: (line: string) => void | Promise<void>;
}

/** Options for a headless final-text run. */
export interface HeadlessTextRunOptions {
  /** Optional writer for the final assistant text output. */
  writeText?: (text: string) => void | Promise<void>;
}

interface HeadlessOutputController {
  /** Queue text for stdout with broken-pipe handling. */
  write(text: string): void;
  /** Attach SIGINT/stdout error handlers for the active run. */
  attach(): void;
  /** Remove SIGINT/stdout error handlers after the run. */
  detach(): void;
  /** Wait for queued writes and resolve the final stop reason. */
  finalize(stopReason: HeadlessStopReason): Promise<HeadlessStopReason>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function defaultWrite(text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;

    const cleanup = (): void => {
      process.stdout.off("error", handleError);
    };

    const settle = (callback: () => void): void => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      callback();
    };

    const handleError = (error: unknown): void => {
      settle(() => {
        reject(error);
      });
    };

    process.stdout.on("error", handleError);
    try {
      process.stdout.write(text, () => {
        settle(resolve);
      });
    } catch (error) {
      settle(() => {
        reject(error);
      });
    }
  });
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

function resolveHeadlessContent(
  state: AppState,
  rawInput: string,
): UserMessage["content"] {
  const resolved = resolveRawInput(rawInput, state);
  switch (resolved.type) {
    case "empty":
      throw new Error("Headless input is empty.");
    case "error":
      throw new Error(resolved.message);
    case "command":
      throw buildCommandError(resolved.command);
    case "message":
      return resolved.content;
  }
}

function extractAssistantText(message: AssistantMessage | null): string {
  if (!message) {
    return "";
  }

  return message.content
    .filter(
      (
        block,
      ): block is Extract<
        AssistantMessage["content"][number],
        { type: "text" }
      > => {
        return block.type === "text";
      },
    )
    .map((block) => block.text)
    .join("");
}

function shouldWriteHeadlessJsonEvent(event: AgentEvent): boolean {
  switch (event.type) {
    case "user_message":
    case "assistant_message":
    case "tool_result":
    case "done":
    case "error":
    case "aborted":
      return true;
    default:
      return false;
  }
}

function createHeadlessOutputController(
  state: AppState,
  writeImpl: (text: string) => void | Promise<void>,
): HeadlessOutputController {
  let brokenPipe = false;
  let outputError: unknown = null;
  let pendingWrite = Promise.resolve();
  const sigintHandler = createSigintHandler(state);

  const stopForBrokenPipe = (): void => {
    if (brokenPipe) {
      return;
    }
    brokenPipe = true;
    state.abortController?.abort();
  };

  const failOutput = (error: unknown): void => {
    if (isBrokenPipeError(error)) {
      stopForBrokenPipe();
      return;
    }

    outputError = outputError ?? error;
    state.abortController?.abort();
  };

  const stdoutErrorHandler = (error: unknown): void => {
    failOutput(error);
  };

  return {
    write(text) {
      if (brokenPipe || outputError) {
        return;
      }

      pendingWrite = pendingWrite.then(async () => {
        if (brokenPipe || outputError) {
          return;
        }

        try {
          await writeImpl(text);
        } catch (error) {
          failOutput(error);
        }
      });
    },
    attach() {
      process.stdout.on("error", stdoutErrorHandler);
      process.on("SIGINT", sigintHandler);
    },
    detach() {
      process.stdout.off("error", stdoutErrorHandler);
      process.off("SIGINT", sigintHandler);
    },
    async finalize(stopReason) {
      await pendingWrite;
      if (outputError) {
        throw outputError;
      }
      return brokenPipe ? "stop" : stopReason;
    },
  };
}

/**
 * Run a single headless prompt to completion and stream completed NDJSON events.
 *
 * The raw input is parsed with the same rules as interactive input. Slash
 * commands are rejected in headless mode. Persisted messages and terminal
 * events are written as one JSON object per line; streaming delta/progress
 * events are omitted.
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
): Promise<HeadlessStopReason> {
  const content = resolveHeadlessContent(state, rawInput);
  const output = createHeadlessOutputController(
    state,
    options?.writeLine ?? ((line) => defaultWrite(`${line}\n`)),
  );
  const hooks: SubmitTurnHooks = {
    onEvent: (event) => {
      if (!shouldWriteHeadlessJsonEvent(event)) {
        return;
      }
      output.write(JSON.stringify(event));
    },
  };

  output.attach();
  try {
    const stopReason = await submitResolvedInput(
      rawInput,
      content,
      state,
      hooks,
    );
    return await output.finalize(stopReason);
  } finally {
    output.detach();
  }
}

/**
 * Run a single headless prompt to completion and write only the final assistant text.
 *
 * The raw input is parsed with the same rules as interactive input. Slash
 * commands are rejected in headless mode. Only the final persisted assistant
 * message's text content is written to stdout.
 *
 * @param state - Mutable application state for the run.
 * @param rawInput - Exact raw prompt text supplied by the user.
 * @param options - Optional final-text output overrides.
 * @returns The terminal stop reason for the agent loop.
 */
export async function runHeadlessPromptText(
  state: AppState,
  rawInput: string,
  options?: HeadlessTextRunOptions,
): Promise<HeadlessStopReason> {
  const content = resolveHeadlessContent(state, rawInput);
  const output = createHeadlessOutputController(
    state,
    options?.writeText ?? defaultWrite,
  );
  let finalAssistantMessage: AssistantMessage | null = null;
  const hooks: SubmitTurnHooks = {
    onEvent: (event) => {
      if (event.type === "assistant_message") {
        finalAssistantMessage = event.message;
      }
    },
  };

  output.attach();
  try {
    const stopReason = await submitResolvedInput(
      rawInput,
      content,
      state,
      hooks,
    );
    const finalText = extractAssistantText(finalAssistantMessage);
    if (finalText.length > 0) {
      output.write(finalText);
    }
    return await output.finalize(stopReason);
  } finally {
    output.detach();
  }
}
