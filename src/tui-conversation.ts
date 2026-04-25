import { SyntaxHighlight } from "@cel-tui/components";
import { HStack, type Node, Text, VStack } from "@cel-tui/core";
import type {
  AssistantMessage,
  Message,
  ToolResultMessage,
  UserMessage,
} from "@mariozechner/pi-ai";
import { estimateTokens, relativeTime } from "./shared";
import { TextPill, theme } from "./tui-components";
import type { TUIState } from "./types";

function agentMessageNode(msg: AssistantMessage): Node {
  const textBlocks: Node[] = msg.content.map((block) => {
    if (block.type === "text") {
      return SyntaxHighlight(block.text, "markdown");
    }
    if (block.type === "thinking") {
      if (!block.thinking.length) return Text("");

      const tokens = estimateTokens(block.thinking);

      return HStack({}, [
        HStack({ width: 4 }, []),
        Text(`Thinking... (~${tokens} tokens)`, {
          fgColor: theme.bblack,
          italic: true,
        }),
      ]);
    }

    let text = "";
    let node: Node | undefined;
    if ("path" in block.arguments) {
      text = block.arguments.path;
      node = Text(text);
    } else if ("command" in block.arguments) {
      text = block.arguments.command;
      node = SyntaxHighlight(text, "bash");
    } else if ("prompt" in block.arguments) {
      text = block.arguments.prompt;
      node = SyntaxHighlight(text, "markdown");
    } else {
      node = Text("Unknown tool");
    }

    return VStack({ padding: { x: 4 } }, [
      TextPill(block.name, theme.white, theme.bblack),
      node,
    ]);
  });

  return VStack({ gap: 1 }, textBlocks);
}

function userMessageNode(msg: UserMessage): Node {
  let text = "";
  if (typeof msg.content === "string") {
    text = msg.content;
  } else {
    text = msg.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n");
  }

  return VStack(
    {
      padding: { x: 1, y: 1 },
      bgColor: theme.bblack,
      fgColor: theme.white,
    },
    [SyntaxHighlight(text, "markdown")],
  );
}

function toolMessageNode(msg: ToolResultMessage): Node {
  let textBlocks = msg.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");

  const newlines = textBlocks.split("\n");
  const max = 4;
  if (newlines.length > max) {
    textBlocks = `...\n${newlines.slice(-max).join("\n")}`;
  }

  const charsPerLine = 100;
  if (textBlocks.length > max * charsPerLine) {
    textBlocks = `...${textBlocks.slice(-(max * charsPerLine))}`;
  }

  return VStack({ gap: 1 }, [
    Text(textBlocks, { wrap: "word", fgColor: theme.bblack }),
  ]);
}

function conversationMessageNode(msg: Message): Node {
  const body =
    msg.role === "assistant"
      ? agentMessageNode(msg)
      : msg.role === "user"
        ? userMessageNode(msg)
        : msg.role === "toolResult"
          ? toolMessageNode(msg)
          : Text("Unknown message?", { wrap: "word", fgColor: theme.bwhite });

  return VStack({ gap: 1 }, [
    body,
    HStack({ gap: 1, justifyContent: "end" }, [
      Text(`${relativeTime(msg.timestamp)} ago.`, {
        fgColor: theme.bblack,
        italic: true,
      }),
      TextPill(msg.role, theme.bwhite, theme.bblack),
    ]),
  ]);
}

export function Conversation(state: TUIState) {
  return VStack(
    {
      flex: 1,
      gap: 1,
      overflow: "scroll",
      scrollOffset: state.stickToBottom ? Infinity : state.scrollOffset,
      onScroll(offset, maxOffset) {
        state.scrollOffset = offset;
        state.stickToBottom = offset >= maxOffset;
      },
    },
    state.messages.map(conversationMessageNode),
  );
}
