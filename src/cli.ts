/**
 * CLI argument parsing and launch-mode selection.
 *
 * @module
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Parsed CLI options for the current launch. */
export interface CliOptions {
  /** One-shot prompt text, or `null` when not provided. */
  prompt: string | null;
  /** Whether to stream headless output as NDJSON instead of final text. */
  json: boolean;
}

/** TTY availability for stdin/stdout. */
export interface TtyState {
  /** Whether stdin is attached to a TTY. */
  stdinIsTTY: boolean;
  /** Whether stdout is attached to a TTY. */
  stdoutIsTTY: boolean;
}

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

/**
 * Parse supported CLI arguments.
 *
 * Supports `-p, --prompt <text>` for headless one-shot mode and `--json`
 * to stream NDJSON events instead of the default final-text mode
 * (stdout final answer plus stderr activity snippets).
 * Unknown flags and positional arguments fail eagerly.
 *
 * @param argv - Process arguments excluding the Bun executable and script path.
 * @returns The parsed CLI options.
 */
export function parseCliArgs(argv: readonly string[]): CliOptions {
  let prompt: string | null = null;
  let json = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg) {
      continue;
    }

    if (arg === "-p" || arg === "--prompt") {
      const value = argv[index + 1];
      if (value == null) {
        throw new Error("Missing value for -p/--prompt.");
      }
      prompt = value;
      index += 1;
      continue;
    }

    if (arg.startsWith("--prompt=")) {
      prompt = arg.slice("--prompt=".length);
      continue;
    }

    if (arg === "--json") {
      json = true;
      continue;
    }

    if (arg.startsWith("-")) {
      throw new Error(`Unknown argument: ${arg}`);
    }

    throw new Error(`Unexpected positional argument: ${arg}`);
  }

  return { prompt, json };
}

// ---------------------------------------------------------------------------
// Mode selection
// ---------------------------------------------------------------------------

/**
 * Return whether the current launch should run in headless mode.
 *
 * Headless mode is selected when a one-shot prompt was provided or when
 * either stdin or stdout is not attached to a TTY.
 *
 * @param options - Parsed CLI options.
 * @param tty - Current TTY availability.
 * @returns `true` when headless mode should be used.
 */
export function shouldUseHeadlessMode(
  options: CliOptions,
  tty: TtyState,
): boolean {
  return options.prompt !== null || !tty.stdinIsTTY || !tty.stdoutIsTTY;
}

/**
 * Resolve the raw prompt text for headless mode.
 *
 * Prefers the explicit CLI prompt. Otherwise reads all of stdin. Empty or
 * whitespace-only input is rejected.
 *
 * @param options - Parsed CLI options.
 * @param tty - Current TTY availability.
 * @param readStdin - Callback that returns the full stdin contents.
 * @returns The raw prompt text to submit.
 */
export async function resolveHeadlessPrompt(
  options: CliOptions,
  tty: TtyState,
  readStdin: () => Promise<string>,
): Promise<string> {
  const rawPrompt =
    options.prompt !== null
      ? options.prompt
      : tty.stdinIsTTY
        ? null
        : await readStdin();

  if (rawPrompt === null) {
    throw new Error("Headless mode requires -p/--prompt or piped stdin.");
  }
  if (rawPrompt.trim().length === 0) {
    throw new Error("Headless input is empty.");
  }

  return rawPrompt;
}
