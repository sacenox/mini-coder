import { basename } from "node:path";
import { cel, HStack, ProcessTerminal, VStack } from "@cel-tui/core";
import type { Message, ToolCall, ToolResultMessage } from "@mariozechner/pi-ai";
import { streamAgent, TASK_PROMPT } from "./agent";
import { getApiKey } from "./oauth";
import { onceEvery, secureRandomString, takeTail } from "./shared";
import { bash, runBashTool } from "./tool-bash";
import { edit, runEditTool } from "./tool-edit";
import { TextPill, theme } from "./tui-components";
import { Conversation } from "./tui-conversation";
import { Editor } from "./tui-editor";
import type { ToolAndRunner, TUIMessage, TUIState } from "./types";

export function initTUI(state: TUIState, leave: (s: string) => void) {
  const cwd = basename(process.cwd());

  // TODO: move to components, have a function return the everyFn and current spinner
  const spinnerFrames = ["⠤", "⠆", "⠒", "⠰"];
  let spinnerTick = 0;
  const spinnerEvery = onceEvery(5, () => spinnerTick++);
  const currentSpinner = () =>
    spinnerFrames[spinnerTick % spinnerFrames.length];

  // Because we don't render often, the ui feels unresponsive at times.
  // This ensure 60fps, and excessive calls get coalesced in cel-tui.
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
            clearInterval(baseFramerateIntervalId);
            cel.stop();
            leave("Done.");
          }
        },
      },
      [
        Conversation(state),

        HStack({ gap: 1 }, [
          TextPill(state.options.model.name, theme.bblack, theme.bwhite),
          TextPill(`../${cwd}`, theme.bwhite, theme.bblack),
          VStack({ flex: 1 }, []),
          TextPill(state.activeState, theme.bwhite, theme.bblack),
          state.streaming
            ? TextPill(currentSpinner(), theme.bblack, theme.bwhite)
            : TextPill(currentSpinner(), theme.bwhite, theme.bblack),
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

// Create the TUIState message for context tool call and result.
function createTUIToolMessage(
  source: ToolCall | ToolResultMessage,
  existing?: Partial<TUIMessage>,
): TUIMessage {
  // This truncation is TUI only. The file is also
  // truncated at tool level to avoid big files being
  // sent to the llm. We truncate that even further for the user.
  // We only show the tail of the file, which includes if the file
  // was truncated at tool level to the user.

  // Join text if there is more than one block.
  const showLines = 6;
  const content = "content" in source ? source.content : [];
  const text = content.length
    ? content
        .map((c) => (c.type === "text" ? c.text : ""))
        .filter((c) => Boolean(c))
        .join("\n")
    : (existing?.content ?? "");
  // Grab the tail
  let tail = takeTail(text.split("\n"), showLines).join("\n");
  // Some commands output without newlines tons of chars.
  // if needed to take roughly 6 lines at 100 chars worth of tail.
  if (tail.length > showLines * 100) {
    tail = tail.slice(showLines * 100 * -1);
  }

  // Now the similar cut is needed in arguments, but here we care about
  // seeing the start of the command, like `cd bla/ && cat ...`
  const argsMaxLength = 600; // estimaded by 100 char line width x 10 lines.
  let args = existing?.header ?? "Writting...";
  if ("arguments" in source && "command" in source.arguments) {
    args =
      source.arguments?.command?.length > argsMaxLength
        ? source.arguments.command.substring(0, argsMaxLength)
        : source.arguments.command;
  }

  const msg: TUIMessage = {
    id: "id" in source ? source.id : (existing?.id ?? secureRandomString(8)),
    timestamp:
      "timestamp" in source
        ? source.timestamp
        : (existing?.timestamp ?? Date.now()),
    role: "tool",
    label: "name" in source ? source.name : (existing?.label ?? ""),
    header: args,
    content: tail,
    durationMs: existing?.durationMs ? existing.durationMs : 0,
  };
  return msg;
}

export async function streamTUI(state: TUIState) {
  if (state.streaming) return;
  state.streaming = true;

  const lastTs = Date.now();
  const apiKey = await getApiKey(state.options);
  const tools: ToolAndRunner[] = [
    { tool: bash, runner: runBashTool },
    { tool: edit, runner: runEditTool },
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

  await streamAgent(
    apiKey,
    tools,
    TASK_PROMPT,
    messages,
    state.options,
    (ev) => {
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
          state.activeState = "idle";

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
          state.activeState = "idle";
          cel.render();
          break;

        case "error":
          state.activeState = "idle";
          break;
      }
    },

    (tool) => {
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
      cel.render();
    },

    (msg, context) => {
      const dur = Date.now() - lastTs;

      if (msg.errorMessage) {
        state.messages.push({
          id: secureRandomString(8),
          role: "agent",
          content: `Error (${msg.stopReason}): ${msg.errorMessage}`,
          timestamp: Date.now(),
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
          timestamp: Date.now(),
          durationMs: dur,
        });
      }

      state.streaming = false;
      state.context = context;
      cel.render();
    },
  );
}
