import { cel, HStack, Text, VStack } from "@cel-tui/core";
import { TextPill, theme } from "./tui-components";
import type { TUIState } from "./types";

function timeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);

  if (seconds < 60) return `${seconds}s ago`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;

  const weeks = Math.floor(days / 7);
  if (weeks < 4) return `${weeks}w ago`;

  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;

  const years = Math.floor(days / 365);
  return `${years}y ago`;
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
        cel.render();
      },
    },
    [
      ...state.messages.map((msg) => {
        const dur = msg.durationMs ? `Took ${msg.durationMs / 1000}s` : "-";
        return VStack({ gap: 1 }, [
          Text(msg.content, { wrap: "word" }),
          HStack({ gap: 1, justifyContent: "end" }, [
            Text(timeAgo(msg.timestamp), {
              fgColor: theme.bblack,
              italic: true,
            }),
            Text(dur, {
              fgColor: theme.bblack,
              italic: true,
            }),
            TextPill(msg.role, theme.bwhite, theme.bblack),
          ]),
        ]);
      }),
    ],
  );
}
