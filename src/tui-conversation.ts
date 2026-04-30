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

  // Remove any reminders we might have attached before render
  // Keep this fast, it runs on the render cycle.
  text = text
    .replaceAll(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "")
    .trimStart();

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
  const text = msg.content
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("")
    .trim();

  return VStack({ padding: { x: 4 }, gap: 1 }, [
    Text(`~${estimateTokens(text)} tokens, ${text.split("\n").length} lines.`, {
      fgColor: theme.bblack,
    }),
    VStack(
      {
        flex: 1,
        maxHeight: msg.toolName === "edit" ? 20 : 10,
        overflow: "scroll",
        scrollOffset: Infinity,
        onScroll: () => false,
      },
      [
        msg.toolName === "edit"
          ? SyntaxHighlight(text, "diff")
          : Text(text, { wrap: "word", fgColor: theme.white }),
      ],
    ),
  ]);
}

const messageBodyCache = new WeakMap<Message, { key: number; node: Node }>();

function messageCacheKey(msg: Message): number {
  if (msg.role === "assistant") {
    let key = 0;
    for (const block of msg.content) {
      if (block.type === "thinking") key += block.thinking.length;
      if (block.type === "text") key += block.text.length;
      if (block.type === "toolCall" && block.arguments)
        key += JSON.stringify(block.arguments).length;
    }
    if (msg.stopReason) key += msg.stopReason.length;
    if (msg.errorMessage) key += msg.errorMessage.length;
    return key;
  }
  if (msg.role === "user") {
    if (typeof msg.content === "string") return msg.content.length;
    return msg.content.reduce(
      (sum, b) => (b.type === "text" ? sum + b.text.length : sum),
      0,
    );
  }
  if (msg.role === "toolResult") {
    return msg.content.reduce(
      (sum, b) => (b.type === "text" ? sum + b.text.length : sum),
      0,
    );
  }
  return 0;
}

function cachedMessageBody(msg: Message): Node {
  const key = messageCacheKey(msg);
  const cached = messageBodyCache.get(msg);
  if (cached && cached.key === key) {
    return cached.node;
  }
  const node =
    msg.role === "assistant"
      ? agentMessageNode(msg)
      : msg.role === "user"
        ? userMessageNode(msg)
        : msg.role === "toolResult"
          ? toolMessageNode(msg)
          : Text("Unknown message?", {
              wrap: "word",
              fgColor: theme.bwhite,
            });
  messageBodyCache.set(msg, { key, node });
  return node;
}

function conversationMessageNode(msg: Message): Node {
  const label = msg.role === "toolResult" ? `${msg.toolName} result` : msg.role;
  return VStack({ gap: 1 }, [
    cachedMessageBody(msg),
    HStack({ gap: 1, justifyContent: "end" }, [
      Text(`${relativeTime(msg.timestamp)} ago.`, {
        fgColor: theme.bblack,
        italic: true,
      }),
      TextPill(label, theme.bwhite, theme.bblack),
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
    VStack({ flex: 1, alignItems: "center", gap: 1 }, [
      HStack({ gap: 1 }, [
        Text("mini"),
        TextPill("coder", theme.black, randColor),
      ]),
      VStack({ gap: 1 }, [
        HStack({ gap: 1 }, [
          TextPill("/new", randColor, theme.bblack, 13),
          Text("Start a new session from the input box.", {
            fgColor: theme.bblack,
          }),
        ]),
        HStack({ gap: 1 }, [
          TextPill("ctrl+p", randColor, theme.bblack, 13),
          Text("Menu for session history, and settings.", {
            fgColor: theme.bblack,
          }),
        ]),
        HStack({ gap: 1 }, [
          TextPill("ESC", randColor, theme.bblack, 13),
          Text("Abort agent response.", { fgColor: theme.bblack }),
        ]),
        HStack({ gap: 1 }, [
          TextPill("ctrl+c|d|q", randColor, theme.bblack, 13),
          Text("Quit.", { fgColor: theme.bblack }),
        ]),
      ]),
    ]),
  ]);
}

export function Conversation(state: TUIState) {
  return VStack(
    {
      flex: 1,
      gap: 3,
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
