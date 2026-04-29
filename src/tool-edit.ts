import { isAbsolute, join } from "node:path";
import { type Tool, Type } from "@mariozechner/pi-ai";
import { createPatch } from "diff";
import type { ToolRunnerEvent } from "./types";

const description = `## Edit tool

A find-and-replace file editor. Use it to create new files or modify existing ones safely. Always prefer this tool over bash editing methods (sed, awk, etc).

### Rules
- The tool refuses to edit on multiple matches of \`oldText\`. Be specific with your matching text.
- Prefer patch-based edits (small targeted replacements) for multi-line or semantic changes.
- Do NOT reproduce entire files. Use shell file operations (\`cp\`, \`mv\`, etc) for wholesale file replacement instead.

### Failure modes
- If \`oldText\` is not found, the edit fails. Verify the exact text first.
- If \`oldText\` matches multiple locations, the edit fails. Narrow your match and retry.
- If the file does not exist and \`oldText\` is non-empty, the edit fails.

<example>
Edit a single line:
path: src/utils.ts
oldText: const MAX_RETRIES = 3;
newText: const MAX_RETRIES = 5;
</example>

<example>
Patch-based edit (preferred for multi-line changes):
path: src/utils.ts
oldText: function oldHelper() {\n  return 1;\n}
newText: function newHelper() {\n  return 2;\n}\n\nfunction oldHelper() {\n  return 1;\n}
</example>
`;

export const edit: Tool = {
  name: `edit`,
  description,
  parameters: Type.Object({
    path: Type.String({
      description:
        "File path. Absolute or relative to the current working directory.",
    }),
    oldText: Type.String({
      description:
        'Exact text to find and replace. Empty string means "create new file".',
    }),
    newText: Type.String({
      description: "Replacement text (or full content for new files)",
    }),
  }),
};

function findAllIndexes(text: string, sub: string): number[] {
  if (sub.length === 0) return [];

  const indexes: number[] = [];

  let pos = text.indexOf(sub, 0);
  while (pos !== -1) {
    indexes.push(pos);
    pos += sub.length; // use pos += 1 if you want overlapping matches
    pos = text.indexOf(sub, pos);
  }

  return indexes;
}

export async function* runEditTool(
  args: Record<string, any>,
  signal?: AbortSignal,
): AsyncGenerator<ToolRunnerEvent> {
  const filePath = isAbsolute(args.path)
    ? args.path
    : join(process.cwd(), args.path);
  const file = Bun.file(filePath);
  const exists = await file.exists();

  if (args.oldText === "") {
    if (exists) {
      yield { type: "result", text: `File already exists: ${filePath}` };
      return;
    }

    await Bun.write(file, args.newText);
    yield {
      type: "result",
      text: `File written: ${filePath}\n\n${args.newText}`,
    };
    return;
  }

  if (!exists) {
    yield { type: "result", text: `File not found: ${filePath}` };
    return;
  }

  const content = await file.text();
  const matches = findAllIndexes(content, args.oldText);

  if (matches.length === 0) {
    yield { type: "result", text: `Old text not found in: ${filePath}` };
    return;
  }

  if (matches.length > 1) {
    yield {
      type: "result",
      text: `Multiple matches found in ${filePath}: ${matches.length} matches, be more specific and try again`,
    };
    return;
  }

  const idx = matches[0];
  const updated =
    content.slice(0, idx) +
    args.newText +
    content.slice(idx + args.oldText.length);

  if (signal?.aborted) {
    yield { type: "result", text: "Aborted before write." };
    return;
  }

  await file.write(updated);
  const patch = createPatch(filePath, content, updated);

  yield {
    type: "result",
    text: `File edited: ${filePath}\n\n${patch}`,
  };

  return;
}
