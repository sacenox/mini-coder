import { basename } from "node:path";
import type { Color } from "@cel-tui/core";
import { cel, HStack, ProcessTerminal, Text, VStack } from "@cel-tui/core";
import {
  type Context,
  completeSimple,
  type Message,
  streamSimple,
  type Tool,
} from "@mariozechner/pi-ai";
import { TASK_PROMPT } from "./agent";
import { getApiKey } from "./oauth";
import { bash, runBashTool } from "./tool-bash";
import { Editor } from "./tui-editor";
import type { TUIMessage, TUIState } from "./types";

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

  cel.render();

  const apiKey = await getApiKey(state.options);
  const tools: Tool[] = [bash];

  let context: Context;
  if (state.context) context = state.context;
  else {
    context = state.context = {
      systemPrompt: TASK_PROMPT,
      messages: [],
      tools,
    };
  }
  const message = {
    content: state.prompt,
    role: "user",
    timestamp: Date.now(),
  };
  context.messages.push(message as Message);

  state.messages.push(message as TUIMessage);
  state.prompt = "";
  cel.render();

  while (true) {
    const s = streamSimple(state.options.model, context, {
      apiKey,
      reasoning: state.options.effort,
    });

    for await (const ev of s) {
      switch (ev.type) {
        case "text_start":
          state.activeState = "answering";
          cel.render();
          break;
        case "thinking_start":
          state.activeState = "thinking";
          cel.render();
          break;
        case "toolcall_start":
          state.activeState = "calling_tool";
          cel.render();
          // TODO: tool call id? So I can update the right state.
          // TUImessages.push({
          //   role: "tool",
          //   content: "Calling tool...",
          // });
          // cel.render()
          break;
        case "toolcall_end":
          // TODO: find pending tool call, update it's entry in TUImessages.
          break;
        case "done":
          state.activeState = "idle";
          cel.render();
          break;
        case "error":
          state.messages.push({
            role: "tool",
            content:
              (ev.error.errorMessage as string) ?? ev.error.content ?? "",
            timestamp: Date.now(),
          });
          state.activeState = "idle";
          cel.render();
          // TODO: find matching tool call if any and update that, or push the new error message.
          break;
      }
    }

    const finalMessage = await s.result();
    context.messages.push(finalMessage);
    const finalContent = finalMessage.content
      .map((m) => m.type === "text" && m.text)
      .filter((m) => Boolean(m));

    if (finalContent.length > 0) {
      state.messages.push({
        role: "agent",
        content: finalContent.join("\n"),
        timestamp: Date.now(),
      });
      cel.render();
    }

    const toolCalls = finalMessage.content.filter((b) => b.type === "toolCall");
    for (const call of toolCalls) {
      const result = await runBashTool(call.arguments.command);

      context.messages.push({
        role: "toolResult",
        toolCallId: call.id,
        toolName: call.name,
        content: [{ type: "text", text: result }],
        isError: false,
        timestamp: Date.now(),
      });
      state.messages.push({
        role: "tool",
        content: result.substring(0, result.length > 6000 ? 6000 : undefined),
        timestamp: Date.now(),
      });
      cel.render()
    }

    if (toolCalls.length > 0) {
      // TODO: Investigate why we get an error: `No output for tool call id XXXX...` when
      //       we add { apiKey } in this call. And how does it work without it?
      const cont = await completeSimple(state.options.model, context, {
        reasoning: state.options.effort,
      });
      context.messages.push(cont);
    }

    // TODO: Update TUIMessages to include usage, so we can show in the UI?
    // console.log(
    //   `Total tokens: ${finalMessage.usage.input} in, ${finalMessage.usage.output} out`,
    // );
    // console.log(`Cost: $${finalMessage.usage.cost.total.toFixed(4)}`);

    if (["stop", "error", "aborted"].includes(finalMessage.stopReason)) {
      state.streaming = false;
      return;
      // TODO: Update TUIMessages to include duration
      // console.log(`Reason for stopping: "${finalMessage.stopReason}"`);
      // const dur = Date.now() - context.messages[0].timestamp;
      // console.log(`Done. Took ${dur / 1000}s`);
    }
  }
}
