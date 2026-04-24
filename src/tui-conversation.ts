import {
  HStack,
  measureContentHeight,
  type Node,
  Text,
  VStack,
} from "@cel-tui/core";
import { elapsedTime, relativeTime } from "./shared";
import { TextPill, theme } from "./tui-components";
import { memoizedSyntaxHighlight } from "./tui-syntax-highlight";
import type { TUIMessage, TUIState } from "./types";

const gap = 1;

type ConversationLayout = {
  messages: TUIMessage[];
  count: number;
  width: number;
  heights: number[];
  tops: number[];
  totalHeight: number;
};

let cachedLayout: ConversationLayout | undefined;

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

function getConversationLayout(
  messages: TUIMessage[],
  width: number,
): ConversationLayout {
  if (
    cachedLayout &&
    cachedLayout.messages === messages &&
    cachedLayout.count === messages.length &&
    cachedLayout.width === width
  ) {
    return cachedLayout;
  }

  const heights = messages.map((msg) =>
    measureContentHeight(conversationMessageNode(msg), { width }),
  );

  const tops: number[] = [];
  let totalHeight = 0;

  for (let i = 0; i < heights.length; i++) {
    tops.push(totalHeight);
    totalHeight += heights[i];
    if (i < heights.length - 1) {
      totalHeight += gap;
    }
  }

  cachedLayout = {
    messages,
    count: messages.length,
    width,
    heights,
    tops,
    totalHeight,
  };

  return cachedLayout;
}

export function Conversation(state: TUIState) {
  // The root viewport only adds padding.x = 1 on each side.
  const width = Math.max(20, (process.stdout.columns ?? 80) - 2);
  const viewportEstimate = Math.max(10, (process.stdout.rows ?? 24) - 8);
  const overscan = viewportEstimate;
  const { heights, tops, totalHeight } = getConversationLayout(
    state.messages,
    width,
  );

  const scrollTop = state.stickToBottom
    ? Math.max(0, totalHeight - viewportEstimate)
    : Math.max(0, Math.min(state.scrollOffset, totalHeight));

  const minY = Math.max(0, scrollTop - overscan);
  const maxY = scrollTop + viewportEstimate + overscan;

  let start = 0;
  while (start < heights.length && tops[start] + heights[start] <= minY) {
    start++;
  }

  let end = start;
  while (end < heights.length && tops[end] < maxY) {
    end++;
  }

  // Always render at least one item when possible.
  if (end === start && end < heights.length) {
    end++;
  }

  const children: Node[] = [];

  // Spacer before first visible item.
  if (start > 0) {
    children.push(VStack({ height: tops[start] - gap }, []));
  }

  children.push(
    ...state.messages.slice(start, end).map(conversationMessageNode),
  );

  // Spacer after last visible item.
  if (end < heights.length) {
    children.push(VStack({ height: totalHeight - tops[end] }, []));
  }

  return VStack(
    {
      flex: 1,
      gap,
      overflow: "scroll",
      scrollOffset: state.stickToBottom ? Infinity : state.scrollOffset,
      onScroll(offset, maxOffset) {
        state.scrollOffset = offset;
        state.stickToBottom = offset >= maxOffset;
      },
    },
    children,
  );
}
