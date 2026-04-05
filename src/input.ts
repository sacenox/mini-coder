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
  "model",
  "session",
  "new",
  "fork",
  "undo",
  "reasoning",
  "verbose",
  "login",
  "logout",
  "help",
  "effort",
] as const;

/** A recognized slash command name. */
export type Command = (typeof COMMANDS)[number];

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
export type ParsedInput =
  | { type: "command"; command: Command; args: string }
  | { type: "skill"; skillName: string; userText: string }
  | { type: "image"; path: string }
  | { type: "text"; text: string };

/** Options for input parsing. */
export interface ParseInputOpts {
  /** Whether the current model supports image input. */
  supportsImages?: boolean;
  /** Working directory for resolving relative image paths. */
  cwd?: string;
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

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

  // Empty or whitespace-only
  if (trimmed.length === 0) {
    return { type: "text", text: "" };
  }

  // Slash-prefixed: command or skill
  if (trimmed[0] === "/") {
    // Skill reference: /skill:name [rest]
    const skillMatch = trimmed.match(/^\/skill:(\S+)(?:\s+(.*))?$/s);
    if (skillMatch?.[1]) {
      return {
        type: "skill",
        skillName: skillMatch[1],
        userText: skillMatch[2]?.trim() ?? "",
      };
    }

    // Slash command: /name [args]
    const cmdMatch = trimmed.match(/^\/(\S+)(?:\s+(.*))?$/s);
    if (cmdMatch?.[1] && COMMAND_SET.has(cmdMatch[1])) {
      return {
        type: "command",
        command: cmdMatch[1] as Command,
        args: cmdMatch[2]?.trim() ?? "",
      };
    }

    // Not a recognized command or skill — fall through to text
  }

  // Image path detection
  if (opts?.supportsImages) {
    const ext = extname(trimmed).toLowerCase();
    if (IMAGE_EXTENSIONS.has(ext)) {
      const resolved = isAbsolute(trimmed)
        ? trimmed
        : opts.cwd
          ? join(opts.cwd, trimmed)
          : trimmed;
      if (existsSync(resolved)) {
        return { type: "image", path: resolved };
      }
    }
  }

  // Plain text
  return { type: "text", text: trimmed };
}
