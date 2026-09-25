import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { Type, type Static } from "@earendil-works/pi-ai";
import { createTwoFilesPatch } from "diff";
import type { ToolResult } from "./common.ts";

export const EDIT_PARAMS = Type.Object(
  {
    path: Type.String({ description: "File path" }),
    oldText: Type.String({ description: "Exact text to replace; empty to create a file" }),
    newText: Type.String({ description: "Replacement text" }),
  },
  { additionalProperties: false },
);
type EditArgs = Static<typeof EDIT_PARAMS>;

export function edit(args: EditArgs, signal: AbortSignal): ToolResult {
  const { path, oldText, newText } = args;
  const exists = existsSync(path);

  if (oldText === "") {
    if (exists) return { text: `edit failed: ${path} already exists`, isError: true };
    if (signal.aborted) return { text: "edit cancelled", isError: true };
    writeFileSync(path, newText);
    return { text: `created ${path}\n${unified(path, "", newText)}`, isError: false };
  }

  if (!exists) return { text: `edit failed: ${path} does not exist`, isError: true };
  const before = readFileSync(path, "utf8");
  const count = before.split(oldText).length - 1;
  if (count === 0) return { text: `edit failed: oldText not found in ${path}`, isError: true };
  if (count > 1) return { text: `edit failed: oldText matches ${count} times in ${path}`, isError: true };

  const after = before.replace(oldText, newText);
  if (signal.aborted) return { text: "edit cancelled", isError: true };
  writeFileSync(path, after);
  return { text: `edited ${path}\n${unified(path, before, after)}`, isError: false };
}

function unified(path: string, before: string, after: string): string {
  return createTwoFilesPatch(path, path, before, after, "", "", { context: 3 });
}
