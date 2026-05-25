import { SyntaxHighlight } from "@cel-tui/components";
import { HStack, type Node, Text, VStack } from "@cel-tui/core";
import { estimateTokens } from "./shared";
import { TextPill, theme } from "./tui-components";
import type { TUIMessage, TUIState, TUIToolCall } from "./types";

export function emptyState(): Node {
  const randColor = theme.bgreen;
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

function ConversationMessageToolCall(call: TUIToolCall) {
  let outputNode: Node | null = null;

  // Compress read and bash calls
  if (call.tool === "read") {
    outputNode = Text(`Read ~${estimateTokens(call.output)} tokens`, {
      wrap: "word",
    });
  } else if (call.tool === "bash") {
    const tail = call.output.trim().slice(-200);
    const blocks: Node[] = [];

    if (tail.length !== call.output.trim().length) {
      blocks.push(
        Text("Showing the last 200 characters", {
          fgColor: theme.bblack,
          italic: true,
        }),
        Text(`[...] ${tail}`, { fgColor: theme.white, wrap: "word" }),
      );
    } else {
      blocks.push(Text(tail, { fgColor: theme.white, wrap: "word" }));
    }

    outputNode = VStack({ width: "100%" }, blocks);
  } else if (call.tool === "edit") {
    outputNode = SyntaxHighlight(call.output, "patch");
  } else {
    outputNode = Text(call.output, { wrap: "word" });
  }

  let argumentNodes: Node[] = [];

  if (call.tool === "edit") {
    argumentNodes = [
      Text(`Writing... ~${estimateTokens(JSON.stringify(call.args))} tokens`),
    ];
  } else {
    argumentNodes = Object.entries(call.args).map(([key, value]) => {
      let node: Node | null = Text(String(value));

      // Syntax highlight bash args
      if (call.tool === "bash") {
        node = SyntaxHighlight(String(value), "bash");
        return node;
      }

      return HStack({ gap: 1 }, [
        Text(`${key}`, { italic: true, fgColor: theme.white }),
        node,
      ]);
    });
  }

  return VStack({}, [
    TextPill(call.tool, theme.black, theme.bwhite),
    ...argumentNodes,
    outputNode,
  ]);
}

function ConversationMessage(message: TUIMessage) {
  const blocks: Node[] = [];

  if (message.thinking) {
    // Compress thinking blocks
    const estThinkingTok = estimateTokens(message.thinking);
    blocks.push(
      Text(`Thinking... ~${estThinkingTok} tokens`, {
        wrap: "word",
        fgColor: theme.bblack,
      }),
    );
  }

  if (message.text.length) {
    blocks.push(
      VStack(
        {
          width: "100%",
          bgColor: message.role === "user" ? theme.bblack : undefined,
          padding: { y: 1, x: message.role === "user" ? 1 : 0 },
        },
        [SyntaxHighlight(message.text, "markdown")],
      ),
    );
  }

  if (message.toolCalls?.length) {
    blocks.push(
      VStack({ gap: 1 }, message.toolCalls.map(ConversationMessageToolCall)),
    );
  }

  if (!message.thinking && !message.text.length && !message.toolCalls?.length) {
    blocks.push(
      Text(`Loading...`, {
        wrap: "word",
        fgColor: theme.bblack,
      }),
    );
  }

  // Msg footer:
  blocks.push(
    Text(`on ${message.timestamp} by ${message.role}`, {
      fgColor: theme.bblack,
      italic: true,
    }),
  );

  return VStack(
    {
      gap: 1,
    },
    blocks,
  );
}

export function Conversation(state: TUIState) {
  return VStack(
    {
      flex: 1,
      gap: 2,
      overflow: "scroll",
      scrollOffset: state.stickToBottom ? Infinity : state.scrollOffset,
      onScroll(offset, maxOffset) {
        state.scrollOffset = offset;
        state.stickToBottom = offset >= maxOffset;
      },
    },
    state.tuiMessages.map(ConversationMessage),
  );
}
