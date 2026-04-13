/**
 * Input-area rendering and path-autocomplete helpers for the terminal UI.
 *
 * @module
 */

import { readdirSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { Text, TextInput } from "@cel-tui/core";
import type { Node } from "@cel-tui/types";
import type { Theme } from "../theme.ts";

const INPUT_PLACEHOLDER =
  "`Ctrl+R` for input history, `/` + `Tab` for interactive menu, or type a message…";

/** Stable callbacks for the controlled TextInput. */
export interface InputController {
  /** Update the controlled input value and re-render. */
  onChange: (value: string) => void;
  /** Mark the input as focused and re-render. */
  onFocus: () => void;
  /** Mark the input as blurred and re-render. */
  onBlur: () => void;
  /** Intercept submit/autocomplete keys before default editing runs. */
  onKeyPress: (key: string) => boolean | undefined;
}

/** A selectable path-autocomplete match for the current input draft. */
export interface InputPathMatch {
  /** Path label shown in the overlay. */
  label: string;
  /** Full draft value to apply when this match is selected. */
  value: string;
}

function listInputPathMatches(value: string, cwd: string): InputPathMatch[] {
  const tokenMatch = /(^|\s)(\S+)$/.exec(value);
  if (!tokenMatch?.[2]) {
    return [];
  }

  const token = tokenMatch[2];
  const tokenStart = tokenMatch.index + tokenMatch[1]!.length;
  const slashIndex = token.lastIndexOf("/");
  const dirToken = slashIndex >= 0 ? token.slice(0, slashIndex + 1) : "";
  const partial = token.slice(slashIndex + 1);
  const searchDir = isAbsolute(token)
    ? dirToken || "/"
    : join(cwd, dirToken || ".");

  const entries = (() => {
    try {
      return readdirSync(searchDir, {
        encoding: "utf8",
        withFileTypes: true,
      });
    } catch {
      return null;
    }
  })();
  if (!entries) {
    return [];
  }

  const showHidden = partial.startsWith(".");
  return entries
    .filter((entry) => (showHidden ? true : !entry.name.startsWith(".")))
    .filter((entry) => entry.name.startsWith(partial))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((entry) => {
      const completedPath = `${dirToken}${entry.name}${entry.isDirectory() ? "/" : ""}`;
      return {
        label: completedPath,
        value: `${value.slice(0, tokenStart)}${completedPath}`,
      };
    });
}

/**
 * Find selectable path matches for the final path token in the current draft.
 *
 * @param value - Current input draft.
 * @param cwd - Working directory used to resolve relative paths.
 * @returns Matching path completions with their applied draft values.
 */
export function findInputPathMatches(
  value: string,
  cwd: string,
): InputPathMatch[] {
  return listInputPathMatches(value, cwd);
}

/**
 * Attempt to autocomplete the final path token in the current draft.
 *
 * @param value - Current input draft.
 * @param cwd - Working directory used to resolve relative paths.
 * @returns The completed input value, or `null` when direct completion is unavailable.
 */
export function autocompleteInputPath(
  value: string,
  cwd: string,
): string | null {
  const matches = listInputPathMatches(value, cwd);
  return matches.length === 1 ? matches[0]!.value : null;
}

/**
 * Render the input area.
 *
 * @param theme - Active UI theme.
 * @param controller - Stable TextInput callbacks.
 * @param value - Current input draft.
 * @param focused - Whether the input should be focused.
 * @returns The input area node.
 */
export function renderInputArea(
  theme: Theme,
  controller: InputController,
  value: string,
  focused: boolean,
): Node {
  return TextInput({
    minHeight: 2,
    maxHeight: 10,
    padding: { x: 1 },
    value,
    onChange: controller.onChange,
    placeholder: Text(INPUT_PLACEHOLDER, {
      fgColor: theme.mutedText,
      italic: true,
    }),
    focused,
    onFocus: controller.onFocus,
    onBlur: controller.onBlur,
    onKeyPress: controller.onKeyPress,
  });
}
