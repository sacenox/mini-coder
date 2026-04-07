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

/** Find the longest common prefix across a list of strings. */
function getLongestCommonPrefix(values: readonly string[]): string {
  if (values.length === 0) {
    return "";
  }

  let prefix = values[0]!;
  for (let i = 1; i < values.length && prefix.length > 0; i++) {
    const value = values[i]!;
    let j = 0;
    while (j < prefix.length && j < value.length && prefix[j] === value[j]) {
      j++;
    }
    prefix = prefix.slice(0, j);
  }

  return prefix;
}

/**
 * Attempt to autocomplete the final path token in the current draft.
 *
 * @param value - Current input draft.
 * @param cwd - Working directory used to resolve relative paths.
 * @returns The completed input value, or `null` when no completion is available.
 */
export function autocompleteInputPath(
  value: string,
  cwd: string,
): string | null {
  const tokenMatch = /(^|\s)(\S+)$/.exec(value);
  if (!tokenMatch?.[2]) {
    return null;
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
    return null;
  }

  const showHidden = partial.startsWith(".");
  const matches = entries
    .filter((entry) => (showHidden ? true : !entry.name.startsWith(".")))
    .filter((entry) => entry.name.startsWith(partial))
    .sort((a, b) => a.name.localeCompare(b.name));

  if (matches.length === 0) {
    return null;
  }

  let completedName: string | null = null;
  if (matches.length === 1) {
    const match = matches[0]!;
    completedName = `${match.name}${match.isDirectory() ? "/" : ""}`;
  } else {
    const prefix = getLongestCommonPrefix(matches.map((entry) => entry.name));
    if (prefix.length > partial.length) {
      completedName = prefix;
    }
  }

  if (!completedName) {
    return null;
  }

  return `${value.slice(0, tokenStart)}${dirToken}${completedName}`;
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
    placeholder: Text("message…", { fgColor: theme.mutedText }),
    focused,
    onFocus: controller.onFocus,
    onBlur: controller.onBlur,
    onKeyPress: controller.onKeyPress,
  });
}
