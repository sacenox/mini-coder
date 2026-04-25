import { basename } from "node:path";
import { cel, HStack, ProcessTerminal, VStack } from "@cel-tui/core";
import type {
  AssistantMessage,
  AssistantMessageEvent,
  Context,
  Message,
  ToolResultMessage,
} from "@mariozechner/pi-ai";
import { MAIN_PROMPT, streamAgent } from "./agent";
import { getApiKey } from "./oauth";
import { estimateTokens } from "./shared";
import { bash, runBashTool } from "./tool-bash";
import { edit, runEditTool } from "./tool-edit";
import { runTaskTool, task } from "./tool-task";
import {
  ActivityPill,
  ContextPill,
  Spinner,
  TextPill,
  theme,
} from "./tui-components";
import { Conversation } from "./tui-conversation";
import { Editor } from "./tui-editor";
import type { ToolAndRunner, TUIState } from "./types";

function clearOrAbort(state: TUIState) {
  // Are we mid stream? Abort it.
  if (state.streaming) {
    state.abortController?.abort();
  }

  // Is the user clearing a state prompt?
  if (state.prompt?.length) {
    state.prompt = "";
  }
}

export function initTUI(state: TUIState, leave: (s: string) => void) {
  const cwd = basename(process.cwd());
  const { spinnerEvery, currentSpinner } = Spinner();

  // Stable 60fps rendering.
  // This ensure Xfps, and excessive calls get coalesced in cel-tui.
  const fps = 60;
  const baseFramerateIntervalId = setInterval(() => {
    if (state.streaming) {
      spinnerEvery();
    }
    cel.render();
  }, 1000 / fps);

  cel.init(new ProcessTerminal());
  cel.setTitle(`mc | ${cwd}`);

  cel.viewport(() =>
    VStack(
      {
        height: "100%",
        gap: 1,
        padding: { x: 1, y: 1 },
        onKeyPress: (key) => {
          if (key === "ctrl+q" || key === "ctrl+c" || key === "ctrl+d") {
            // Quit
            clearInterval(baseFramerateIntervalId);
            cel.stop();
            leave("Done.");
          } else if (key === "escape") {
            // Abort or clear prompt
            clearOrAbort(state);
          }
        },
      },
      [
        Conversation(state),

        HStack({ gap: 1 }, [
          TextPill(state.options.model.name, theme.bblack, theme.bwhite),
          TextPill(`../${cwd}`, theme.bwhite, theme.bblack),
          VStack({ flex: 1 }, []),
          ActivityPill(state, currentSpinner()),
          ContextPill(state),
        ]),

        Editor(
          state,
          (value: string) => {
            // onChange
            state.prompt = value;
          },
          (key: string) => {
            // onKeyPress
            if (key === "enter") {
              if (state.prompt === ":q") {
                clearInterval(baseFramerateIntervalId);
                cel.stop();
                leave("Done. I like vim too.");
                return false;
              }
              const submit = async () => {
                await streamTUI(state);
              };
              submit();
              return false;
            }
          },
        ),
      ],
    ),
  );
}

export async function streamTUI(state: TUIState) {
  if (state.streaming) return;
  state.streaming = true;

  const abortController = new AbortController();
  state.abortController = abortController;

  const apiKey = await getApiKey(state.options);
  const tools: ToolAndRunner[] = [
    { tool: bash, runner: runBashTool },
    { tool: edit, runner: runEditTool },
    {
      tool: task,
      runner: async (args: Record<string, any>) => {
        return runTaskTool({ ...state.options, abortController }, args);
      },
    },
  ];

  const userMessage: Message = {
    role: "user",
    content: state.prompt || "",
    timestamp: Date.now(),
  };
  state.messages.push(userMessage);
  const existingMessages: Message[] = [...state.messages];

  state.prompt = "";
  cel.render();

  let partial: AssistantMessage | null = null;

  const onStream = (ev: AssistantMessageEvent, ctx: Context) => {
    switch (ev.type) {
      case "start":
        partial = ev.partial;
        state.messages.push(partial);
        state.contextSize = estimateTokens(JSON.stringify(ctx));
        break;

      case "text_start":
      case "text_delta":
      case "text_end":
      case "thinking_start":
      case "thinking_delta":
      case "thinking_end":
      case "toolcall_start":
      case "toolcall_delta":
      case "toolcall_end":
        if (partial) {
          partial = ev.partial;
          state.messages[state.messages.length - 1] = partial;
          state.contextSize = estimateTokens(JSON.stringify(ctx));
        }
        break;
    }
  };

  const onTool = (tool: ToolResultMessage, ctx: Context) => {
    state.messages.push(tool);
    state.contextSize = estimateTokens(JSON.stringify(ctx));
  };

  const onComplete = (msg: AssistantMessage, ctx: Context) => {
    if (partial) {
      state.messages[state.messages.length - 1] = msg;
    } else {
      state.messages.push(msg);
    }
    state.contextSize = estimateTokens(JSON.stringify(ctx));
  };

  try {
    await streamAgent(
      apiKey,
      tools,
      MAIN_PROMPT,
      existingMessages,
      state.options,
      state.abortController,
      onStream,
      onTool,
      onComplete,
    );
  } finally {
    state.streaming = false;
  }
}
