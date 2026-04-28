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
  let thinking = "";
  let text = "";
  const toolCalls: Node[] = [];

  for (const block of msg.content) {
    if (block.type === "thinking" && block.thinking.length > 0) {
      thinking += block.thinking;
    }

    if (block.type === "text" && block.text.length > 0) {
      text += block.text;
    }

    if (block.type === "toolCall" && block.arguments && block.name) {
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
        text = JSON.stringify(block.arguments);
        node = Text(text);
      }

      toolCalls.push(
        VStack({ padding: { x: 4 }, gap: 1 }, [
          TextPill(block.name, theme.white, theme.bblack),
          node,
        ]),
      );
    }
  }
  const textBlocks: Node[] = [];
  if (thinking.length > 0) {
    const tokens = estimateTokens(thinking);

    textBlocks.push(
      Text(`Thinking... (~${tokens} tokens)`, {
        fgColor: theme.bblack,
        italic: true,
      }),
    );
  }
  if (text.length > 0) {
    textBlocks.push(SyntaxHighlight(text, "markdown"));
  }
  if (toolCalls.length > 0) {
    textBlocks.push(...toolCalls);
  }
  const error =
    ((msg.stopReason === "error" || msg.stopReason === "aborted") &&
      msg.errorMessage) ??
    "Unknown error.";
  if (error) {
    textBlocks.push(
      VStack({ padding: { x: 4 }, gap: 1 }, [
        TextPill(msg.stopReason, theme.white, theme.bblack),
        Text(error),
      ]),
    );
  }

  if (textBlocks.length === 0) {
    textBlocks.push(
      Text("Loading...", {
        fgColor: theme.bblack,
        italic: true,
      }),
    );
  }

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
      .join("");
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
  // Output only shows last 10 lines of scroll.
  return VStack(
    {
      height: 10,
      padding: { x: 4 },
      overflow: "scroll",
      scrollOffset: Infinity,
      onScroll: () => false,
    },
    msg.content.map((block) => {
      if (block.type === "text") {
        return Text(block.text, { wrap: "word", fgColor: theme.bblack });
      }
      return Text(""); // TODO: image case needs attention
    }),
  );
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

const colors = [
  theme.bgreen,
  theme.byellow,
  theme.bblue,
  theme.bcyan,
  theme.bmagenta,
  theme.bred,
];
const randColor = colors[Math.floor(Math.random() * colors.length)];

export function emptyState(): Node {
  return HStack({ flex: 1, alignItems: "center" }, [
    VStack({ flex: 1, alignItems: "center" }, [
      HStack({ gap: 1 }, [
        Text("mini"),
        TextPill("coder", theme.black, randColor),
      ]),
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
