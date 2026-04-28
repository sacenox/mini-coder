import { cel, HStack, ProcessTerminal, VStack } from "@cel-tui/core";
import simpleGit from "simple-git";
import { streamAgent } from "./agent";
import {
  buildSystemPrompt,
  insertToolUsageReminder,
  MAIN_PROMPT,
} from "./prompt";
import { estimateTokens } from "./shared";
import { bash, runBashTool } from "./tool-bash";
import { edit, runEditTool } from "./tool-edit";
import { runTaskTool, task } from "./tool-task";
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
import { SelectOverlay } from "./tui-overlay";
import type { AgentContex, ToolAndRunner, TUIState } from "./types";

const git = simpleGit();

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
  const { spinnerEvery, currentSpinner } = Spinner();

  // Stable 60fps rendering.
  // This ensure Xfps, and excessive calls get coalesced in cel-tui.
  const fps = 60;
  const baseFramerateIntervalId = setInterval(() => {
    if (state.streaming) {
      spinnerEvery();
    }
    cel.setTitle(
      `mc ${state.streaming ? currentSpinner() : ">"} ../${state.cwd}`,
    );
    cel.render();
  }, 1000 / fps);

  cel.init(new ProcessTerminal());

  const onWindowKeyPress = (key: string) => {
    if (key === "ctrl+q" || key === "ctrl+c" || key === "ctrl+d") {
      // Quit
      clearInterval(baseFramerateIntervalId);
      cel.stop();
      leave("Done.");
    } else if (key === "escape") {
      // Abort or clear prompt
      clearOrAbort(state);
    } else if (key === "ctrl+p") {
      state.overlay = true;
    }
  };

  const onChange = (value: string) => {
    state.prompt = value;
  };

  const onEditorKeyPress = (key: string) => {
    // onKeyPress
    if (key === "enter") {
      if (state.prompt === ":q") {
        clearInterval(baseFramerateIntervalId);
        cel.stop();
        leave("Done. I like vim too.");
        return false;
      }
      const submit = async () => {
        await streamAgentTUI(state);
      };
      if (state.prompt && !state.streaming) submit();
      return false;
    }
  };

  cel.viewport(() => {
    const layers = [
      VStack(
        {
          height: "100%",
          gap: 1,
          padding: { x: 1, y: 1 },
          onKeyPress: onWindowKeyPress,
        },
        [
          state.messages.length ? Conversation(state) : emptyState(),
          HStack({ gap: 1 }, [
            ModelPill(state),
            TextPill(`../${state.cwd}`, theme.bwhite, theme.bblack),
            GitPill(state),
            VStack({ flex: 1 }, []),
            ActivityPill(state, currentSpinner()),
            ContextPill(state),
          ]),

          Editor(state, onChange, onEditorKeyPress),
        ],
      ),
    ];
    if (state.overlay) {
      // TODO: Use the new select overlay for menus
      layers.push(SelectOverlay(state, state.prompt, [
        "> Models", "Effort"
      ]));
    }

    return layers;
  });
}

async function streamAgentTUI(state: TUIState) {
  state.streaming = true;

  const abortController = new AbortController();
  state.abortController = abortController;

  const tools: ToolAndRunner[] = [
    { tool: bash, runner: runBashTool },
    { tool: edit, runner: runEditTool },
    {
      tool: task,
      runner: (args, signal) => runTaskTool(state.options, args, signal),
    },
  ];

  state.messages.push({
    role: "user",
    content: state.prompt,
    timestamp: Date.now(),
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

  // We send a reference to state.messages, so things just render.
  // We just need to react to some updates.
  const agent = streamAgent(ctx);
  try {
    for await (const ev of agent) {
      switch (ev.type) {
        case "message_start":
        case "message_update":
          break;

        case "message_end":
          state.contextSize = estimateTokens(JSON.stringify(ctx));
          break;

        case "tool_message_start":
        case "tool_message_update":
          break;

        case "tool_message_end": {
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

          state.contextSize = estimateTokens(JSON.stringify(ctx));
        }
      }
    }
  } finally {
    state.streaming = false;
  }

  try {
    const gitStatus = (await git.status()).isClean() ? "" : "*";
    const gitBranch = (await git.branch()).current;
    state.gitBranch = `${gitBranch}${gitStatus}`;
  } catch (_) {}
}
