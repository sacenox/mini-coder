import type { ToolCall, ToolResultMessage } from "@mariozechner/pi-ai";
import { estimateTokens, secureRandomString, takeTail } from "./shared";
import type { TUIMessage } from "./types";

// Create the TUIState message for context tool call and result.
export function createTUIToolMessage(
  source: ToolCall | ToolResultMessage,
  existing?: Partial<TUIMessage>,
): TUIMessage {
  // This truncation is TUI only. The file is also
  // truncated at tool level to avoid big files being
  // sent to the llm. We truncate that even further for the user.
  // We only show the tail of the file, which includes if the file
  // was truncated at tool level to the user.

  // Join text if there is more than one block.
  const showLines = 10;
  const content = "content" in source ? source.content : [];
  const text = content.length
    ? content
        .map((c) => (c.type === "text" ? c.text : ""))
        .filter((c) => Boolean(c))
        .join("\n")
    : (existing?.content ?? "");
  // Grab the tail
  let tail = takeTail(text.split("\n"), showLines).join("\n");
  // Some commands output without newlines tons of chars.
  // if needed to take roughly X lines at 100 chars worth of tail.
  if (tail.length > showLines * 100) {
    tail = tail.slice(showLines * 100 * -1);
  }

  // Now the similar cut is needed in arguments, but here we care about
  // seeing the start of the command, like `cd bla/ && cat ...`
  const argsMaxLength = 100 * showLines; // estimated by 100 char line width times X lines.
  let args = existing?.header ?? "Writing...";

  // Shell tool call
  if ("arguments" in source && "command" in source.arguments) {
    args =
      source.arguments?.command?.length > argsMaxLength
        ? source.arguments.command.substring(0, argsMaxLength)
        : source.arguments.command;
  }

  // Edit tool call
  if ("arguments" in source && "path" in source.arguments) {
    const before = source.arguments.oldText;
    const after = source.arguments.newText;
    const tokensWritten = estimateTokens(
      [source.arguments.path, before, after].join(""),
    );
    args = `Wrote ~${tokensWritten} tokens.`;
  }

  const msg: TUIMessage = {
    id: "id" in source ? source.id : (existing?.id ?? secureRandomString(8)),
    timestamp:
      "timestamp" in source
        ? source.timestamp
        : (existing?.timestamp ?? Date.now()),
    role: "tool",
    label: "name" in source ? source.name : (existing?.label ?? ""),
    header: args,
    content: tail,
    durationMs: existing?.durationMs ? existing.durationMs : 0,
  };
  return msg;
}
