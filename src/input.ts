/**
 * User input parsing.
 *
 * Pure logic for detecting slash commands, skill references, image paths,
 * and plain text from raw user input. No UI or IO beyond `existsSync`
 * for image path validation.
 *
 * @module
 */

import { existsSync } from "node:fs";
import { extname, isAbsolute, join } from "node:path";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** All recognized slash commands. */
export const COMMANDS = [
  "session",
  "new",
  "fork",
  "undo",
  "reasoning",
  "verbose",
  "todo",
  "login",
  "logout",
  "help",
  "model",
  "effort",
] as const;

/** A recognized slash command name. */
type Command = (typeof COMMANDS)[number];

const COMMAND_SET: ReadonlySet<string> = new Set(COMMANDS);

/** Image file extensions we recognize for embedding. */
const IMAGE_EXTENSIONS: ReadonlySet<string> = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
]);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Result of parsing user input. */
type ParsedInput =
  | { type: "command"; command: Command; args: string }
  | { type: "skill"; skillName: string; userText: string }
  | { type: "image"; path: string }
  | { type: "text"; text: string };

/** Options for input parsing. */
interface ParseInputOpts {
  /** Whether the current model supports image input. */
  supportsImages?: boolean;
  /** Working directory for resolving relative image paths. */
  cwd?: string;
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

function isCommand(value: string): value is Command {
  return COMMAND_SET.has(value);
}

function parseSlashInput(trimmed: string): ParsedInput | null {
  const skillMatch = trimmed.match(/^\/skill:(\S+)(?:\s+(.*))?$/s);
  if (skillMatch?.[1]) {
    return {
      type: "skill",
      skillName: skillMatch[1],
      userText: skillMatch[2]?.trim() ?? "",
    };
  }

  const commandMatch = trimmed.match(/^\/(\S+)(?:\s+(.*))?$/s);
  const command = commandMatch?.[1];
  if (!command || !isCommand(command)) {
    return null;
  }

  return {
    type: "command",
    command,
    args: commandMatch[2]?.trim() ?? "",
  };
}

function resolveImagePath(input: string, cwd?: string): string {
  if (isAbsolute(input) || !cwd) {
    return input;
  }
  return join(cwd, input);
}

function parseImageInput(
  trimmed: string,
  opts?: ParseInputOpts,
): Extract<ParsedInput, { type: "image" }> | null {
  if (!opts?.supportsImages) {
    return null;
  }
  if (!IMAGE_EXTENSIONS.has(extname(trimmed).toLowerCase())) {
    return null;
  }

  const resolvedPath = resolveImagePath(trimmed, opts.cwd);
  if (!existsSync(resolvedPath)) {
    return null;
  }

  return { type: "image", path: resolvedPath };
}

/**
 * Parse raw user input into a structured result.
 *
 * Priority order:
 * 1. Slash commands (`/model`, `/help`, etc.)
 * 2. Skill references (`/skill:name rest of message`)
 * 3. Image paths (entire input is an existing image file)
 * 4. Plain text
 *
 * @param raw - The raw input string from the user.
 * @param opts - Optional parsing context (image support, cwd).
 * @returns A {@link ParsedInput} describing what the input represents.
 */
export function parseInput(raw: string, opts?: ParseInputOpts): ParsedInput {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { type: "text", text: "" };
  }

  if (trimmed[0] === "/") {
    const slashInput = parseSlashInput(trimmed);
    if (slashInput) {
      return slashInput;
    }
  }

  const imageInput = parseImageInput(trimmed, opts);
  if (imageInput) {
    return imageInput;
  }

  return { type: "text", text: trimmed };
}
