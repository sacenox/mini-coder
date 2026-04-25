import { HStack, type Node, Text, VStack } from "@cel-tui/core";
import { elapsedTime, relativeTime } from "./shared";
import { TextPill, theme } from "./tui-components";
import { memoizedSyntaxHighlight } from "./tui-syntax-highlight";
import type { TUIMessage, TUIState } from "./types";

function agentMessageNode(msg: TUIMessage): Node {
  return memoizedSyntaxHighlight(
    (msg.id ? msg.id : "") + String(msg.timestamp),
    msg.content,
    "markdown",
  );
}

function userMessageNode(msg: TUIMessage): Node {
  return VStack(
    {
      padding: { x: 1, y: 1 },
      bgColor: theme.bblack,
      fgColor: theme.white,
    },
    [
      memoizedSyntaxHighlight(
        msg.id ?? String(msg.timestamp),
        msg.content,
        "markdown",
      ),
    ],
  );
}

function toolMessageNode(msg: TUIMessage): Node {
  return VStack({ gap: 1 }, [
    memoizedSyntaxHighlight(
      msg.id ?? String(msg.timestamp),
      msg.header ?? "",
      msg.label === "bash" ? "bash" : "markdown",
    ),
    Text(msg.content, { wrap: "word", fgColor: theme.bblack }),
  ]);
}

function conversationMessageNode(msg: TUIMessage): Node {
  const dur = msg.durationMs
    ? `Took ${elapsedTime(msg.durationMs / 1000)}`
    : "-";

  const body =
    msg.role === "agent"
      ? agentMessageNode(msg)
      : msg.role === "user"
        ? userMessageNode(msg)
        : msg.role === "tool"
          ? toolMessageNode(msg)
          : Text(msg.content, { wrap: "word", fgColor: theme.bwhite });

  return VStack({ gap: 1 }, [
    body,
    HStack({ gap: 1, justifyContent: "end" }, [
      Text(`${relativeTime(msg.timestamp)} ago.`, {
        fgColor: theme.bblack,
        italic: true,
      }),
      Text(dur, {
        fgColor: theme.bblack,
        italic: true,
      }),
      TextPill(msg.label ?? msg.role, theme.bwhite, theme.bblack),
    ]),
  ]);
}

export function Conversation(state: TUIState) {
  // TODO: We need inteligent caching?
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
