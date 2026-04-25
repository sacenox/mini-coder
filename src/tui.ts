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
import { estimateTokens, secureRandomString } from "./shared";
import { bash, runBashTool } from "./tool-bash";
import { edit, runEditTool } from "./tool-edit";
import { runTaskTool, task } from "./tool-task";
import { ActivityPill, Spinner, TextPill, theme } from "./tui-components";
import { Conversation } from "./tui-conversation";
import { Editor } from "./tui-editor";
import { createTUIToolMessage } from "./tui-state";
import type { ToolAndRunner, TUIMessage, TUIState } from "./types";

function clearOrAbort(state: TUIState) {
  // Are we mid stream? Abort it.
  if (state.streaming) {
    state.abortController?.abort();
  }

  // Is the user clearing a state prompt?
  if (state.prompt?.length) {
    state.prompt = "";
    cel.render();
  }
}

function ContextPill(state: TUIState) {
  let text = "";
  if (!state.context) {
    text = "0%";
  } else {
    const current = estimateTokens(JSON.stringify(state.context));
    const max = state.options.model.contextWindow;
    const percent = Math.floor((current / max) * 100);
    text = `~${percent}%`;
  }

  return TextPill(text, theme.bblack, theme.bwhite);
}

export function initTUI(state: TUIState, leave: (s: string) => void) {
  const cwd = basename(process.cwd());
  const { spinnerEvery, currentSpinner } = Spinner();

  // Spinner and animations timer.
  // This ensure Xfps, and excessive calls get coalesced in cel-tui.
  const fps = 30;
  const baseFramerateIntervalId = setInterval(() => {
    if (state.streaming) {
      spinnerEvery();
      cel.render();
    }
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
            cel.render();
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
  const userPrompt = {
    role: "user",
    content: state.prompt || "",
    timestamp: Date.now(),
    id: secureRandomString(8),
  };
  state.messages.push(userPrompt as TUIMessage);
  let messages: Message[] = [userPrompt as Message];
  if (state.context) {
    messages = [...state.context.messages, ...messages];
  }
  state.prompt = "";
  cel.render();

  const onStream = (ev: AssistantMessageEvent, context: Context) => {
    state.context = context;

    // TODO: Improve `src/tui-state.ts` so we can progressively build the ui
    // as the data comes in, instead of relying on the final message.
    // We can do this with the base stream events and our tool callback.
    // onComplete should be only cleanup at that point, no messages state updates.
    switch (ev.type) {
      case "text_start":
        state.activeState = "answering";
        cel.render();
        break;

      case "thinking_start":
        state.activeState = "thinking";
        cel.render();
        break;

      case "toolcall_start": {
        state.activeState = "calling_tool";

        // Create initial tool tui messages
        const newToolCalls = ev.partial.content.filter(
          (c) => c.type === "toolCall",
        );

        for (const call of newToolCalls) {
          const toolMessage = createTUIToolMessage(call);
          let found = false;
          state.messages = state.messages.map((msg) => {
            if (call.id === msg.id) {
              found = true;
              return toolMessage;
            }
            return msg;
          });
          if (!found) state.messages.push(toolMessage);
        }

        cel.render();
        break;
      }

      case "toolcall_end": {
        state.activeState = "waiting";

        // Collect tool calls state
        const finishedToolCalls = ev.partial.content.filter(
          (c) => c.type === "toolCall",
        );

        // Update tui messages with arguments
        for (const call of finishedToolCalls) {
          let updated = false;
          state.messages = state.messages.map((msg) => {
            if (call.id === msg.id) {
              updated = true;
              return createTUIToolMessage(call, msg);
            }
            return msg;
          });
          if (!updated) {
            state.messages.push(createTUIToolMessage(call));
          }
        }

        cel.render();
        break;
      }

      case "done":
        state.activeState = "waiting";
        cel.render();
        break;

      case "error":
        state.activeState = "idle";
        break;
    }
  };

  const onTool = (tool: ToolResultMessage, context: Context) => {
    // Append the output to the existing TUI messages
    state.messages = state.messages.map((msg) => {
      if (tool.toolCallId === msg.id) {
        return createTUIToolMessage(tool, {
          ...msg,
          durationMs: Date.now() - msg.timestamp,
        });
      }
      return msg;
    });
    state.context = context;
    cel.render();
  };

  const onComplete = (msg: AssistantMessage, context: Context) => {
    const dur = Date.now() - msg.timestamp;

    if (msg.errorMessage) {
      state.messages.push({
        id: secureRandomString(8),
        role: "agent",
        content: `Error (${msg.stopReason}): ${msg.errorMessage}`,
        timestamp: msg.timestamp,
        durationMs: dur,
      });
    } else {
      const text = msg.content
        .filter((c) => c.type === "text")
        .map((c) => c.text)
        .join("\n");
      state.messages.push({
        id: secureRandomString(8),
        role: "agent",
        content: text,
        timestamp: msg.timestamp,
        durationMs: dur,
      });
    }

    state.streaming = false;
    state.activeState = "idle";
    state.context = context;
    cel.render();
  };

  await streamAgent(
    apiKey,
    tools,
    MAIN_PROMPT,
    messages,
    state.options,
    state.abortController,
    onStream,
    onTool,
    onComplete,
  );
}
