import { cel, HStack, ProcessTerminal, VStack } from "@cel-tui/core";
import type {
  AssistantMessage,
  ToolResultMessage,
} from "@earendil-works/pi-ai";
import { streamAgent } from "./agent";
import { getBranchLabel } from "./git";
import {
  buildSystemPrompt,
  injectEnvReminder,
  insertToolUsageReminder,
  MAIN_PROMPT,
} from "./prompt";
import { updateSession } from "./session";
import {
  estimateContextTokens,
  formatTimestamp,
  secureRandomString,
} from "./shared";
import { getTUITheme } from "./themes";
import { bash, runBashTool } from "./tool-bash";
import { edit, runEditTool } from "./tool-edit";
import { read, runReadTool } from "./tool-read";
import {
  ActivityPill,
  ContextPill,
  GitPill,
  ModelPill,
  Spinner,
  TextPill,
  theme,
} from "./tui-components";
import { Conversation, emptyState } from "./tui-conversation";
import { Editor } from "./tui-editor";
import { mainMenu } from "./tui-overlay";
import type { AgentContex, ToolAndRunner, TUIMessage, TUIState } from "./types";
import { getAvailableUpdate } from "./update";

async function refreshAvailableUpdate(state: TUIState): Promise<void> {
  state.availableUpdate = await getAvailableUpdate();
}

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
  // TODO: Cleanup accumulated sessions for this cwd.
  const spinner = Spinner((frame) => {
    if (state.streaming) cel.setTitle(`mc ${frame} ../${state.cwd}`);
  });

  let menu = mainMenu(state);

  const quit = (message: string) => {
    spinner.dispose();
    cel.stop();
    leave(message);
  };

  const onWindowKeyPress = (key: string) => {
    if (key === "ctrl+q" || key === "ctrl+c" || key === "ctrl+d") {
      // Quit
      quit("Done.");
    } else if (key === "escape") {
      // Abort or clear prompt
      clearOrAbort(state);
    } else if (key === "ctrl+p") {
      menu = mainMenu(state);
      state.overlay = true;
    } else if (key === "ctrl+f") {
      menu = mainMenu(state, "fork");
      state.overlay = true;
    }
  };

  const onChange = (value: string) => {
    state.prompt = value;
  };

  const onEditorKeyPress = (key: string) => {
    const submit = async () => {
      await streamAgentTUI(state, spinner);
    };
    // onKeyPress
    if (key === "enter") {
      if (state.prompt === ":q") {
        quit("Done. I like vim too.");
        return false;
      }
      if (state.prompt === ":n" || state.prompt === "/new") {
        state.sessionId = undefined;
        state.messages = [];
        state.tuiMessages = [];
        state.prompt = "";
        state.contextSize = 0;
        state.scrollOffset = 0;
        state.stickToBottom = true;
        return false;
      }
      if (state.prompt && !state.streaming) submit();
      return false;
    }
  };

  const initialTheme = getTUITheme(state.options.theme);
  cel.init(new ProcessTerminal(), { theme: initialTheme.palette });
  cel.setTitle(`mc > ../${state.cwd}`);
  void refreshAvailableUpdate(state).then(() => cel.render());
  cel.viewport(() => {
    const activeTheme = getTUITheme(state.options.theme);
    const layers = [
      VStack(
        {
          height: "100%",
          gap: 1,
          padding: { x: 1, y: 1 },
          onKeyPress: onWindowKeyPress,
          fgColor: activeTheme.rootFgColor,
          bgColor: activeTheme.rootBgColor,
        },
        [
          state.messages.length ? Conversation(state) : emptyState(state),
          HStack({ gap: 1 }, [
            ModelPill(state),
            TextPill(`../${state.cwd}`, theme.bwhite, theme.bblack),
            GitPill(state),
            VStack({ flex: 1 }, []),
            ActivityPill(state, spinner.current),
            ContextPill(state),
          ]),

          Editor(state, onChange, onEditorKeyPress),
        ],
      ),
    ];
    if (state.overlay) {
      layers.push(menu());
    }

    return layers;
  });
}

async function streamAgentTUI(
  state: TUIState,
  spinner: ReturnType<typeof Spinner>,
) {
  // Just as a defensive thought, callers should set this ahead of time if doing other
  // ops before starting the stream.
  state.streaming = true;
  spinner.reset();
  spinner.start();
  cel.setTitle(`mc ${spinner.current} ../${state.cwd}`);

  const abortController = new AbortController();
  state.abortController = abortController;

  const tools: ToolAndRunner[] = [
    { tool: bash, runner: runBashTool },
    { tool: edit, runner: runEditTool },
    { tool: read, runner: runReadTool },
  ];

  let userContent = state.prompt;
  if (state.messages.length === 0) {
    const envReminder = await injectEnvReminder();
    userContent = `${envReminder}\n\n${userContent}`;
  }
  state.messages.push({
    role: "user",
    content: userContent,
    timestamp: Date.now(),
  });
  state.tuiMessages.push({
    timestamp: formatTimestamp(Date.now()),
    role: "user",
    text: state.prompt,
  });
  state.prompt = "";

  const systemPrompt = await buildSystemPrompt(MAIN_PROMPT);
  const ctx: AgentContex = {
    systemPrompt,
    tools,
    messages: state.messages,
    options: state.options,
    signal: state.abortController?.signal,
  };

  const toTUIMessage = (partial: AssistantMessage) => {
    const text = partial.content
      .filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("")
      .trim();
    const thinking = partial.content
      .filter((c) => c.type === "thinking")
      .map((c) => c.thinking)
      .join("")
      .trim();
    const toolCalls = partial.content
      .filter((c) => c.type === "toolCall")
      .map((c) => {
        return {
          id: c.id,
          tool: c.name,
          args: c.arguments,
          output: "",
        };
      });

    return {
      timestamp: formatTimestamp(partial.timestamp),
      role: "assistant" as const,
      text,
      thinking,
      toolCalls,
    };
  };

  const updateToolCall = (
    partial: ToolResultMessage,
    tuiMessages: TUIMessage[],
  ) => {
    tuiMessages.forEach((c) => {
      const parentCall = c.toolCalls?.find((t) => t.id === partial.toolCallId);
      if (parentCall) {
        parentCall.output = partial.content
          .filter((c) => c.type === "text")
          .map((c) => c.text)
          .join("")
          .trim();
      }
    });
  };

  const agent = streamAgent(ctx);
  try {
    for await (const ev of agent) {
      switch (ev.type) {
        case "message_start":
          state.tuiMessages.push(toTUIMessage(ev.partial));
          break;
        case "message_update":
          Object.assign(
            state.tuiMessages[state.tuiMessages.length - 1],
            toTUIMessage(ev.partial),
          );
          break;
        case "message_end": {
          Object.assign(
            state.tuiMessages[state.tuiMessages.length - 1],
            toTUIMessage(ev.message),
          );
          const { systemPrompt, tools, messages } = ctx;
          state.contextSize = estimateContextTokens(
            messages,
            JSON.stringify({ systemPrompt, tools, messages }),
          );
          break;
        }

        case "tool_message_start":
          updateToolCall(ev.partial, state.tuiMessages);
          break;
        case "tool_message_update":
          updateToolCall(ev.partial, state.tuiMessages);
          break;
        case "tool_message_end": {
          updateToolCall(ev.message, state.tuiMessages);
          const withReminder = insertToolUsageReminder(
            state.messages,
            ev.message,
          );

          const idx = state.messages.findIndex(
            (m) =>
              m.role === "toolResult" &&
              m.toolCallId === withReminder.toolCallId,
          );
          if (idx >= 0) {
            state.messages[idx] = withReminder;
          }

          const { systemPrompt, tools, messages } = ctx;
          state.contextSize = estimateContextTokens(
            messages,
            JSON.stringify({ systemPrompt, tools, messages }),
          );
        }
      }
    }
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    state.tuiMessages.push({
      timestamp: formatTimestamp(Date.now()),
      role: "assistant",
      text,
    });
  } finally {
    state.streaming = false;
    spinner.stop();
    cel.setTitle(`mc > ../${state.cwd}`);
    cel.render();
    if (!state.sessionId) {
      const id = secureRandomString(10);
      state.sessionId = id;
    }
    await updateSession(state.sessionId, state.messages);
  }

  state.gitBranch = await getBranchLabel();
  cel.render();
}
