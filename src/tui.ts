import { basename } from "node:path";
import type { Color } from "@cel-tui/core";
import { cel, HStack, ProcessTerminal, Text, VStack } from "@cel-tui/core";
import type { Message } from "@mariozechner/pi-ai";
import { streamAgent, TASK_PROMPT } from "./agent";
import { getApiKey } from "./oauth";
import { bash, runBashTool } from "./tool-bash";
import { Editor } from "./tui-editor";
import type { ToolAndRunner, TUIMessage, TUIState } from "./types";

const theme = {
  black: "color00" as Color,
  bblack: "color08" as Color,

  red: "color01" as Color,
  bred: "color09" as Color,

  green: "color02" as Color,
  bgreen: "color10" as Color,

  yellow: "color03" as Color,
  byellow: "color11" as Color,

  blue: "color04" as Color,
  bblue: "color12" as Color,

  magenta: "color05" as Color,
  bmagenta: "color13" as Color,

  cyan: "color06" as Color,
  bcyan: "color14" as Color,

  white: "color07" as Color,
  bwhite: "color15" as Color,
};

// Examples:
//
// TextPill("mini-coder", theme.bblack, theme.black),
// TextPill("mini-coder", theme.bred, theme.red),
// TextPill("mini-coder", theme.bgreen, theme.green),
// TextPill("mini-coder", theme.byellow, theme.yellow),
// TextPill("mini-coder", theme.bblue, theme.blue),
// TextPill("mini-coder", theme.bmagenta, theme.magenta),
// TextPill("mini-coder", theme.bcyan, theme.cyan),
// TextPill("mini-coder", theme.bwhite, theme.white),
function TextPill(content: string, fgColor: Color, bgColor: Color) {
  return HStack({ gap: 1 }, [
    HStack({ bgColor, padding: { x: 1 } }, [
      Text(content, { bold: true, fgColor }),
    ]),
  ]);
}

export function initTUI(state: TUIState, leave: (s: string) => void) {
  const cwd = basename(process.cwd());

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
            cel.stop();
            leave("Done.");
          }
        },
      },
      [
        VStack({ flex: 1, gap: 1, overflow: "scroll" }, [
          ...state.messages.map((msg) => {
            return VStack({ gap: 1 }, [
              TextPill(msg.role, theme.bwhite, theme.bblack),
              Text(msg.content, { wrap: "word" }),
            ]);
          }),
        ]),

        HStack({ gap: 1 }, [
          TextPill(state.options.model.name, theme.bblack, theme.bwhite),
          TextPill(`../${cwd}`, theme.bwhite, theme.bblack),
          VStack({ flex: 1 }, []),
          TextPill(state.activeState, theme.bwhite, theme.bblack),
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

export async function streamTUI(state: TUIState) {
  if (state.streaming) return;
  state.streaming = true;

  const apiKey = await getApiKey(state.options);
  const tools: ToolAndRunner[] = [{ tool: bash, runner: runBashTool }];
  const userPrompt = {
    role: "user",
    content: state.prompt || "",
    timestamp: Date.now(),
  };
  const messages: Message[] = [userPrompt as Message];
  state.messages.push(userPrompt as TUIMessage);
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

          // Collect tool calls state
          const newToolCalls = ev.partial.content.filter(
            (c) => c.type === "toolCall",
          );

          for (const call of newToolCalls) {
            const toolMessage: TUIMessage = {
              role: "tool",
              content: `${call.name}: ${JSON.stringify(call.arguments, null, 4)}`,
              id: call.id,
              timestamp: Date.now(),
            };
            state.messages = state.messages.map((msg) => {
              if (call.id === msg.id) {
                return toolMessage;
              }
              return msg;
            });
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

          for (const call of finishedToolCalls) {
            const toolMessage: TUIMessage = {
              role: "tool",
              content: `${call.name}: ${JSON.stringify(call.arguments, null, 4)}`,
              id: call.id,
              timestamp: Date.now(),
            };
            let updated = false;
            state.messages = state.messages.map((msg) => {
              if (call.id === msg.id) {
                updated = true;
                return toolMessage;
              }
              return msg;
            });
            if (!updated) {
              state.messages.push(toolMessage);
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
      }
    },

    (tool) => {
      state.messages = state.messages.map((msg) => {
        if (tool.toolCallId === msg.id) {
          const result = tool.content
            .map((c) => (c.type === "text" ? c.text : ""))
            .filter((c) => Boolean(c))
            .join("\n");
          const truncated =
            result.length > 6000
              ? `${result.substring(0, 6000)}...\n\nTruncated at 6000 chars`
              : result;

          return {
            ...msg,
            content: `${tool.toolName}:\n\n${truncated}`,
            timestamp: Date.now(),
          };
        }
        return msg;
      });
      cel.render();
    },

    (msg, context, dur) => {
      const text = msg.content
        .filter((c) => c.type === "text")
        .map((c) => c.text)
        .join("\n");
      state.messages.push({
        role: "agent",
        content: text,
        timestamp: Date.now(),
        durationMs: dur,
      });
      state.streaming = false;
      state.context = context;
      cel.render();
    },
  );
}
