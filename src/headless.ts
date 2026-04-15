/**
 * Headless one-shot execution.
 *
 * @module
 */

import type { AssistantMessage, UserMessage } from "@mariozechner/pi-ai";
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
  /** Optional line writer for NDJSON event output. */
  writeLine?: (line: string) => void;
}

/** Options for a headless final-text run. */
export interface HeadlessTextRunOptions {
  /** Optional writer for the final assistant text output. */
  writeText?: (text: string) => void;
}

interface HeadlessOutputController {
  /** Write text to stdout with broken-pipe handling. */
  write(text: string): void;
  /** Attach SIGINT/stdout error handlers for the active run. */
  attach(): void;
  /** Remove SIGINT/stdout error handlers after the run. */
  detach(): void;
  /** Resolve the final stop reason, converting broken pipes into quiet shutdowns. */
  finalize(stopReason: HeadlessStopReason): HeadlessStopReason;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function defaultWrite(text: string): void {
  process.stdout.write(text);
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

function createHeadlessOutputController(
  state: AppState,
  writeImpl: (text: string) => void,
): HeadlessOutputController {
  let brokenPipe = false;
  let outputError: unknown = null;
  const sigintHandler = createSigintHandler(state);

  const stopForBrokenPipe = (): void => {
    if (brokenPipe) {
      return;
    }
    brokenPipe = true;
    state.abortController?.abort();
  };

  const stdoutErrorHandler = (error: unknown): void => {
    if (isBrokenPipeError(error)) {
      stopForBrokenPipe();
      return;
    }

    outputError = error;
    state.abortController?.abort();
  };

  return {
    write(text) {
      if (brokenPipe) {
        return;
      }

      try {
        writeImpl(text);
      } catch (error) {
        if (!isBrokenPipeError(error)) {
          throw error;
        }
        stopForBrokenPipe();
      }
    },
    attach() {
      process.stdout.on("error", stdoutErrorHandler);
      process.on("SIGINT", sigintHandler);
    },
    detach() {
      process.stdout.off("error", stdoutErrorHandler);
      process.off("SIGINT", sigintHandler);
    },
    finalize(stopReason) {
      if (outputError) {
        throw outputError;
      }
      return brokenPipe ? "stop" : stopReason;
    },
  };
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
): Promise<HeadlessStopReason> {
  const content = resolveHeadlessContent(state, rawInput);
  const output = createHeadlessOutputController(
    state,
    options?.writeLine ?? ((line) => defaultWrite(`${line}\n`)),
  );
  const hooks: SubmitTurnHooks = {
    onEvent: (event) => {
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
    return output.finalize(stopReason);
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
    return output.finalize(stopReason);
  } finally {
    output.detach();
  }
}
