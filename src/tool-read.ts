import { Buffer } from "node:buffer";
import { extname, isAbsolute, join } from "node:path";
import { type Tool, Type } from "@mariozechner/pi-ai";
import type { ToolRunnerEvent } from "./types";

const imageMimeTypes: Record<string, string> = {
  ".bmp": "image/bmp",
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

const description = `## Read tool

Read a file by path.

For text files, returns line-numbered text. Use \`offset\` and \`limit\` to read a specific range.
You can also read images files.
`;

export const read: Tool = {
  name: "read",
  description,
  parameters: Type.Object({
    path: Type.String({
      description:
        "File path. Absolute or relative to the current working directory.",
    }),
    offset: Type.Optional(
      Type.Number({
        description:
          "Optional 1-based line number to start reading from. Text files only.",
      }),
    ),
    limit: Type.Optional(
      Type.Number({
        description:
          "Optional maximum number of lines to read. Text files only.",
      }),
    ),
  }),
};

export async function* runReadTool(
  args: Record<string, any>,
  signal?: AbortSignal,
): AsyncGenerator<ToolRunnerEvent> {
  const filePath = isAbsolute(args.path)
    ? args.path
    : join(process.cwd(), args.path);
  const file = Bun.file(filePath);
  const exists = await file.exists();

  if (!exists) {
    yield { type: "result", text: `File not found: ${filePath}` };
    return;
  }

  if (signal?.aborted) {
    yield { type: "result", text: "Aborted before read." };
    return;
  }

  const mimeType = imageMimeTypes[extname(filePath).toLowerCase()] ?? file.type;
  if (mimeType.startsWith("image/")) {
    const data = Buffer.from(await file.arrayBuffer()).toString("base64");
    const text = `Image read: ${filePath}\nMIME type: ${mimeType}\nSize: ${file.size} bytes`;
    yield {
      type: "result",
      text,
      image: { data, mimeType },
    };
    return;
  }

  const content = await file.text();
  const lines = content.split(/\r?\n/);
  if (content.endsWith("\n")) lines.pop();

  const offset = args.offset ?? 1;
  const startIndex = offset - 1;
  const endIndex = args.limit
    ? Math.min(lines.length, startIndex + args.limit)
    : lines.length;
  const width = String(endIndex).length;
  const body = lines
    .slice(startIndex, endIndex)
    .map((line, idx) => `${String(offset + idx).padStart(width)} | ${line}`)
    .join("\n");

  let text = `File: ${filePath}\nLines: ${offset}-${endIndex} of ${lines.length}\n\n${body}`;
  if (endIndex < lines.length) {
    text += `\n\nMore lines available. Use offset ${endIndex + 1} to continue.`;
  }

  yield { type: "result", text };
}
