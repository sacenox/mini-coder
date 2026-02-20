import { z } from "zod";
import { join, relative } from "path";
import type { ToolDef } from "../llm-api/types.ts";

const ReadInput = z.object({
  path: z.string().describe("File path to read (absolute or relative to cwd)"),
  startLine: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe("First line to read (1-indexed, inclusive)"),
  endLine: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe("Last line to read (1-indexed, inclusive)"),
  cwd: z.string().optional().describe("Working directory for resolving relative paths"),
});

type ReadInput = z.infer<typeof ReadInput>;

export interface ReadOutput {
  path: string;
  content: string;
  totalLines: number;
  startLine: number;
  endLine: number;
  truncated: boolean;
}

const MAX_LINES = 2000;
const MAX_BYTES = 200_000;

export const readTool: ToolDef<ReadInput, ReadOutput> = {
  name: "read",
  description:
    "Read a file's contents. Optionally specify a line range with startLine/endLine. " +
    "Lines are 1-indexed. Large files are automatically truncated.",
  schema: ReadInput,
  execute: async (input) => {
    const cwd = input.cwd ?? process.cwd();
    const filePath = input.path.startsWith("/")
      ? input.path
      : join(cwd, input.path);

    const file = Bun.file(filePath);
    const exists = await file.exists();
    if (!exists) {
      throw new Error(`File not found: ${input.path}`);
    }

    const size = file.size;
    if (size > MAX_BYTES * 5) {
      throw new Error(
        `File too large (${Math.round(size / 1024)}KB). Use grep to search within it.`
      );
    }

    const raw = await file.text();
    const allLines = raw.split("\n");
    const totalLines = allLines.length;

    const startLine = input.startLine ?? 1;
    const endLine = input.endLine ?? Math.min(totalLines, startLine + MAX_LINES - 1);

    const clampedStart = Math.max(1, Math.min(startLine, totalLines));
    const clampedEnd = Math.max(clampedStart, Math.min(endLine, totalLines));

    // Hard cap on lines returned
    const lineCount = clampedEnd - clampedStart + 1;
    const hardEnd =
      lineCount > MAX_LINES ? clampedStart + MAX_LINES - 1 : clampedEnd;
    const truncated = hardEnd < clampedEnd || hardEnd < totalLines;

    const selectedLines = allLines.slice(clampedStart - 1, hardEnd);
    const content = selectedLines
      .map((line, i) => `${clampedStart + i}: ${line}`)
      .join("\n");

    return {
      path: relative(cwd, filePath),
      content,
      totalLines,
      startLine: clampedStart,
      endLine: hardEnd,
      truncated,
    };
  },
};
