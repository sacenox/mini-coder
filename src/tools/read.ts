import { readFileSync } from "node:fs";
import { extname } from "node:path";
import { Type, type Static } from "@earendil-works/pi-ai";
import type { ToolContext, ToolResult } from "./common.ts";

export const READ_PARAMS = Type.Object(
  { path: Type.String({ description: "File path" }) },
  { additionalProperties: false },
);
type ReadArgs = Static<typeof READ_PARAMS>;

const IMAGE_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};

const MAX_TEXT_CHARS = 100_000;
/** Cap on the base64 payload sent to the provider, where the file inflates by 4/3. */
const MAX_IMAGE_BASE64_BYTES = 5 * 1024 * 1024;

export function read(args: ReadArgs, ctx: ToolContext): ToolResult {
  const { path } = args;

  let data: Buffer;
  try {
    data = readFileSync(path);
  } catch (error) {
    return { text: `read failed: ${(error as Error).message}`, isError: true };
  }

  const mime = IMAGE_MIME[extname(path).slice(1).toLowerCase()];
  if (mime !== undefined) {
    if (!ctx.supportsImages) {
      return { text: `read failed: ${path} is an image and the current model does not accept image input`, isError: true };
    }
    const base64 = data.toString("base64");
    if (base64.length > MAX_IMAGE_BASE64_BYTES) {
      return {
        text: `read failed: ${path} encodes to ${base64.length} bytes, over the ${MAX_IMAGE_BASE64_BYTES} byte image limit`,
        isError: true,
      };
    }
    return {
      text: `read ${path} (${mime}, ${data.length} bytes)`,
      isError: false,
      images: [{ type: "image", data: base64, mimeType: mime }],
    };
  }

  if (data.subarray(0, 8000).includes(0)) {
    return { text: `read failed: ${path} is binary; use bash (file, xxd)`, isError: true };
  }

  const text = data.toString("utf8");
  if (text.length > MAX_TEXT_CHARS) {
    return {
      text: text.slice(0, MAX_TEXT_CHARS) + `\n\n... truncated ... ${path} is ${text.length} characters\n`,
      isError: false,
    };
  }
  return { text, isError: false };
}
