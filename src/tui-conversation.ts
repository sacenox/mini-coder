import { cel, HStack, Text, VStack } from "@cel-tui/core";
import { elapsedTime, relativeTime } from "./shared";
import { TextPill, theme } from "./tui-components";
import { memoizedSyntaxHighlight } from "./tui-syntax-highlight";
import type { TUIMessage, TUIState } from "./types";

function agentMessageNode(msg: TUIMessage) {
  return memoizedSyntaxHighlight(
    (msg.id ? msg.id : "") + String(msg.timestamp),
    msg.content,
    "markdown",
  );
}

function userMessageNode(msg: TUIMessage) {
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

function toolMessageNode(msg: TUIMessage) {
  return VStack({ gap: 1 }, [
    memoizedSyntaxHighlight(
      msg.id ?? String(msg.timestamp),
      msg.header ?? "",
      "bash",
    ),
    Text(msg.content, { wrap: "word", fgColor: theme.bblack }),
  ]);
}

export function Conversation(state: TUIState) {
  // TODO: use scroll callbacks to make the conversation a virtual list,
  //       only showing a 12 messages window based the scroll position.
  return VStack(
    {
      flex: 1,
      gap: 1,
      overflow: "scroll",
      scrollOffset: state.stickToBottom ? Infinity : state.scrollOffset,
      onScroll(offset, maxOffset) {
        state.scrollOffset = offset;
        state.stickToBottom = offset >= maxOffset;
        cel.render();
      },
    },
    [
      ...state.messages.map((msg) => {
        const dur = msg.durationMs
          ? `Took ${elapsedTime(msg.durationMs / 1000)}`
          : "-";

        return VStack({ gap: 1 }, [
          msg.role === "agent"
            ? agentMessageNode(msg)
            : msg.role === "user"
              ? userMessageNode(msg)
              : msg.role === "tool"
                ? toolMessageNode(msg)
                : Text(msg.content, { wrap: "word", fgColor: theme.bwhite }),

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
      }),
    ],
  );
}
