import { cel, HStack, Text, VStack } from "@cel-tui/core";
import { TextPill, theme } from "./tui-components";
import { memoizedSyntaxHighlight } from "./tui-syntax-highlight";
import type { TUIState } from "./types";

function elapsedTime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;

  const weeks = Math.floor(days / 7);
  if (weeks < 4) return `${weeks}w`;

  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo`;

  const years = Math.floor(days / 365);
  return `${years}y`;
}

function relativeTime(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  return elapsedTime(seconds);
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
        const dur = msg.durationMs
          ? `Took ${elapsedTime(msg.durationMs / 1000)}`
          : "-";
        return VStack({ gap: 1 }, [
          // TODO: `@cel-tui/components` only keeps **4 cached highlight states per language/theme** (`MAX_STATES_PER_KEY = 4` in the
          //       installed package). After the 4th agent reply, older messages will be re-tokenized from scratch on every render.
          msg.role === "agent"
            ? memoizedSyntaxHighlight(
                msg.id ?? `${Date.now()}`,
                msg.content,
                "markdown",
              )
            : Text(msg.content, { wrap: "word" }),
          HStack({ gap: 1, justifyContent: "end" }, [
            Text(`${relativeTime(msg.timestamp)} ago.`, {
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
