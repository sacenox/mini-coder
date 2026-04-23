import { basename } from "node:path";
import { cel, HStack, ProcessTerminal, VStack } from "@cel-tui/core";
import type { Message } from "@mariozechner/pi-ai";
import { streamAgent, TASK_PROMPT } from "./agent";
import { getApiKey } from "./oauth";
import { bash, runBashTool } from "./tool-bash";
import { TextPill, theme } from "./tui-components";
import { Conversation } from "./tui-conversation";
import { Editor } from "./tui-editor";
import type { ToolAndRunner, TUIMessage, TUIState } from "./types";

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
        Conversation(state),

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
            const toolMessage: TUIMessage = {
              role: "tool",
              content: `${call.name}: ${JSON.stringify(call.arguments, null, 4)}`,
              id: call.id,
              timestamp: Date.now(),
            };
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
          state.activeState = "idle";
          break;
      }
    },

    (tool) => {
      // Append the output to the existing TUI messages
      state.messages = state.messages.map((msg) => {
        if (tool.toolCallId === msg.id) {
          // This truncation is TUI only. The file is also
          // truncated at tool level to avoid big files being
          // sent to the llm. We truncate that even further.
          const truncateLimit = 1000;
          const result = tool.content
            .map((c) => (c.type === "text" ? c.text : ""))
            .filter((c) => Boolean(c))
            .join("\n");
          const truncated =
            result.length > truncateLimit
              ? `${result.substring(0, truncateLimit)}...\n\nTruncated at ${truncateLimit} of ${result.length} chars`
              : result;

          return {
            ...msg,
            content: `${msg.content}\n\n${truncated}`,
            timestamp: Date.now(),
          };
        }
        return msg;
      });
      cel.render();
    },

    (msg, context, dur) => {
      if (msg.errorMessage) {
        state.messages.push({
          role: "agent",
          content: `Error (${msg.stopReason}): ${msg.errorMessage}`,
          timestamp: Date.now(),
        });
      } else {
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
      }

      state.streaming = false;
      state.context = context;
      cel.render();
    },
  );
}
