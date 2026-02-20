import { join, relative } from "node:path";
import { z } from "zod";
import type { ToolDef } from "../llm-api/types.ts";
import { generateDiff } from "./diff.ts";
import { findLineByHash } from "./hashline.ts";

const InsertSchema = z.object({
  path: z.string().describe("File path to edit (absolute or relative to cwd)"),
  anchor: z
    .string()
    .describe('Anchor line from a prior read/grep, e.g. "11:a3"'),
  position: z
    .enum(["before", "after"])
    .describe('Insert the content "before" or "after" the anchor line'),
  content: z.string().describe("Text to insert"),
});

type InsertInput = z.infer<typeof InsertSchema> & { cwd?: string };

export interface InsertOutput {
  path: string;
  diff: string;
}

const HASH_NOT_FOUND_ERROR =
  "Hash not found. Re-read the file to get current anchors.";

export const insertTool: ToolDef<InsertInput, InsertOutput> = {
  name: "insert",
  description:
    "Insert new lines before or after an anchor line in an existing file. " +
    "The anchor line itself is not modified. " +
    'Anchors come from the `read` or `grep` tools (format: "line:hash", e.g. "11:a3"). ' +
    "To replace or delete lines use `edit`. To create a file use `write`.",
  schema: InsertSchema,
  execute: async (input) => {
    const cwd = input.cwd ?? process.cwd();
    const filePath = input.path.startsWith("/")
      ? input.path
      : join(cwd, input.path);

    const relPath = relative(cwd, filePath);

    const file = Bun.file(filePath);
    if (!(await file.exists())) {
      throw new Error(
        `File not found: "${relPath}". To create a new file use the \`write\` tool.`,
      );
    }

    const parsed = parseAnchor(input.anchor);

    const original = await file.text();
    const lines = original.split("\n");

    const anchorLine = findLineByHash(lines, parsed.hash, parsed.line);
    if (!anchorLine) throw new Error(HASH_NOT_FOUND_ERROR);

    const insertAt = input.position === "before" ? anchorLine - 1 : anchorLine;
    const insertLines = input.content.split("\n");

    const updatedLines = [
      ...lines.slice(0, insertAt),
      ...insertLines,
      ...lines.slice(insertAt),
    ];

    const updated = updatedLines.join("\n");
    await Bun.write(filePath, updated);

    const diff = generateDiff(relPath, original, updated);
    return { path: relPath, diff };
  },
};

interface ParsedAnchor {
  line: number;
  hash: string;
}

function parseAnchor(value: string): ParsedAnchor {
  const match = /^\s*(\d+):([0-9a-fA-F]{2})\s*$/.exec(value);
  if (!match) {
    throw new Error(
      `Invalid anchor. Expected format: "line:hh" (e.g. "11:a3").`,
    );
  }

  const line = Number(match[1]);
  if (!Number.isInteger(line) || line < 1) {
    throw new Error("Invalid anchor line number.");
  }

  const hash = match[2];
  if (!hash) {
    throw new Error(
      `Invalid anchor. Expected format: "line:hh" (e.g. "11:a3").`,
    );
  }

  return { line, hash: hash.toLowerCase() };
}
