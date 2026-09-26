import type { Api, Model, Tool } from "@earendil-works/pi-ai";
import type { ToolName } from "../config.ts";
import type { ToolContext, ToolResult } from "./common.ts";
import { BASH_PARAMS, bash, type BashArgs } from "./bash.ts";
import { EDIT_PARAMS, edit, type EditArgs } from "./edit.ts";
import { READ_PARAMS, read, type ReadArgs } from "./read.ts";

export type { ToolResult } from "./common.ts";

/** Whether a model accepts image input. Drives `read`'s description and results. */
export function acceptsImages(model: Model<Api>): boolean {
  return model.input.includes("image");
}

const READ_DESCRIPTION = "Read a file. Returns its text. Prefer bash for search, ranges, or binary files.";
const READ_IMAGE_DESCRIPTION =
  "Read a file. Returns its text, or the image itself when the file is a png, jpg, or webp. " +
  "Prefer bash for search, ranges, or binary files.";

export function toolSchemas(names: ToolName[], withImages: boolean): Tool[] {
  const tools: Record<ToolName, Tool> = {
    edit: {
      name: "edit",
      description:
        "Edit a file by exact text replacement. oldText must occur exactly once. " +
        "With empty oldText, create a new file (fails if it exists).",
      parameters: EDIT_PARAMS,
    },
    read: {
      name: "read",
      description: withImages ? READ_IMAGE_DESCRIPTION : READ_DESCRIPTION,
      parameters: READ_PARAMS,
    },
    bash: {
      name: "bash",
      description: "Run a bash command in the current working directory.",
      parameters: BASH_PARAMS,
    },
  };
  return names.map((name) => tools[name]);
}

export async function executeTool(name: string, args: unknown, ctx: ToolContext): Promise<ToolResult> {
  if (name === "edit") return edit(args as EditArgs, ctx.signal);
  if (name === "read") return read(args as ReadArgs, ctx);
  return bash(args as BashArgs, ctx);
}
