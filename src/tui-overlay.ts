import { HStack, Text, TextInput, VStack } from "@cel-tui/core";
import type { Message, ThinkingLevel } from "@earendil-works/pi-ai";
import { getOAuthProviders } from "@earendil-works/pi-ai/oauth";
import { saveSettings } from "./args";
import { findModelConfig, getProviderModels } from "./models.ts";
import { getAvailableProviders } from "./oauth";
import { listSessionsForCwd } from "./session";
import { estimateTokens, formatTimestamp } from "./shared";
import { TextPill, theme } from "./tui-components";
import type { SelectOptions, SelectState, Session, TUIState } from "./types";

export function SelectOverlay(
  value: string,
  selected: string,
  list: { label: string; value: string }[],
  label: string,
  onOverlayKeyPress: (key: string) => boolean | undefined,
  onChange: (newValue: string) => void,
  onKeyPress: (key: string) => boolean | undefined,
) {
  let isEditorFocused = true;
  return VStack(
    {
      height: "100%",
      justifyContent: "end",
      onKeyPress: onOverlayKeyPress,
    },
    [
      VStack(
        {
          bgColor: theme.white,
          fgColor: theme.bblack,
          gap: 1,
          padding: { x: 1, y: 1 },
        },
        [
          VStack(
            { flex: 1, minHeight: 5, maxHeight: 20, padding: { x: 1 } },
            list.map((i) =>
              i.value === selected
                ? Text(i.label, { fgColor: theme.black })
                : Text(i.label, { fgColor: theme.bblack }),
            ),
          ),

          HStack({ width: "100%" }, [
            TextPill(label, theme.bwhite, theme.bblack),
          ]),

          TextInput({
            value,
            minHeight: 3,
            maxHeight: 10,
            padding: { x: 1 },
            placeholder: Text("Search...", {
              fgColor: theme.bblack,
              italic: true,
            }),
            fgColor: theme.bblack,
            bgColor: theme.white,
            onChange,
            onKeyPress,
            focused: isEditorFocused,
            onFocus: () => {
              isEditorFocused = true;
            },
            onBlur: () => {
              isEditorFocused = false;
            },
          }),
        ],
      ),
    ],
  );
}

export function useSelectOverlay(initialOptions: SelectOptions) {
  // Inner state
  const s: SelectState = {
    value: "",
    selected: "",
    label: "SELECT",
    list: [],
  };
  let baseList: SelectOptions["list"] = [];

  const applyOptions = (
    options: Pick<SelectOptions, "filter" | "label" | "list">,
  ) => {
    baseList = options.list;
    s.value = options.filter ?? "";
    s.label = options.label ? options.label.toUpperCase() : "SELECT";
    s.list = s.value
      ? baseList.filter((i) => i.label.includes(s.value))
      : baseList;
    s.selected = s.list.length ? s.list[0].value : "";
  };

  applyOptions(initialOptions);

  const onChange = (newValue: string) => {
    s.value = newValue;
    s.list = s.value
      ? baseList.filter((i) => i.label.includes(s.value))
      : baseList;
    s.selected = s.list.length ? s.list[0].value : "";
  };

  const moveSelected = (direction: -1 | 1) => {
    if (!s.list.length) return;

    const currentIndex = s.list.findIndex((i) => i.value === s.selected);
    const nextIndex =
      currentIndex === -1
        ? direction === 1
          ? 0
          : s.list.length - 1
        : (currentIndex + direction + s.list.length) % s.list.length;

    s.selected = s.list[nextIndex].value;
  };

  const onMoveKeyPress = (key: string) => {
    if (key !== "up" && key !== "down") return;

    moveSelected(key === "up" ? -1 : 1);
    return false;
  };

  const onEditorKeyPress = (key: string) => {
    const didMove = onMoveKeyPress(key);
    if (didMove === false) return false;

    if (key === "enter") {
      const previousList = s.list;
      const previousBaseList = baseList;
      const applySelectionResult = () => {
        if (s.list !== previousList) {
          baseList = s.list;
        } else {
          s.list = previousBaseList;
          s.selected = s.list.length ? s.list[0].value : "";
        }
      };

      s.value = "";
      const result = initialOptions.onSelect(s);
      if (result instanceof Promise) {
        result.then(applySelectionResult).catch(() => {
          s.list = previousBaseList;
          s.selected = s.list.length ? s.list[0].value : "";
        });
      } else {
        applySelectionResult();
      }
      return false;
    }
  };

  const onOverlayKeyPress = (key: string) => {
    const didMove = onMoveKeyPress(key);
    if (didMove === false) return false;

    if (key === "escape" || key === "ctrl+p") {
      applyOptions(initialOptions);
      initialOptions.onCancel();
    }
    return false;
  };

  return () =>
    SelectOverlay(
      s.value,
      s.selected,
      s.list,
      s.label,
      onOverlayKeyPress,
      onChange,
      onEditorKeyPress,
    );
}

function cleanSnippet(text: string): string {
  return text
    .replaceAll(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 80);
}

function sessionLabel(session: Session): string {
  const firstUserMessage = session.messages.find(
    (message) => message.role === "user",
  );
  if (!firstUserMessage) return session.id;

  const text =
    typeof firstUserMessage.content === "string"
      ? firstUserMessage.content
      : firstUserMessage.content
          .map((block) => (block.type === "text" ? block.text : ""))
          .join(" ");
  const snippet = cleanSnippet(text);

  return snippet || session.id;
}

function messageText(message: Message): string {
  if (message.role === "user") {
    return typeof message.content === "string"
      ? message.content
      : message.content
          .map((content) =>
            content.type === "text" ? content.text : "[image]",
          )
          .join(" ");
  }

  if (message.role === "toolResult") {
    return message.content
      .map((content) => (content.type === "text" ? content.text : "[image]"))
      .join(" ");
  }

  return message.content
    .map((content) => {
      if (content.type === "text") return content.text;
      if (content.type === "thinking") return content.thinking;
      if (content.type === "toolCall") return `tool call: ${content.name}`;
      return "";
    })
    .join(" ");
}

function messageLabel(message: Message, index: number): string {
  const role =
    message.role === "toolResult"
      ? `toolResult:${message.toolName}`
      : message.role;
  const snippet = cleanSnippet(messageText(message));
  const prefix = `${index + 1}. ${role} ${formatTimestamp(message.timestamp)}`;

  return snippet ? `${prefix} — ${snippet}` : prefix;
}

function forkMessages(messages: Message[], selectedIndex: number): Message[] {
  const forkedMessages = messages.slice(0, selectedIndex + 1);
  const toolCallIds = new Set<string>();
  const includedToolResultIds = new Set<string>();

  for (const message of forkedMessages) {
    if (message.role === "assistant") {
      for (const content of message.content) {
        if (content.type === "toolCall") toolCallIds.add(content.id);
      }
    } else if (message.role === "toolResult") {
      includedToolResultIds.add(message.toolCallId);
    }
  }

  for (const message of messages) {
    if (
      message.role === "toolResult" &&
      toolCallIds.has(message.toolCallId) &&
      !includedToolResultIds.has(message.toolCallId)
    ) {
      forkedMessages.push(message);
      includedToolResultIds.add(message.toolCallId);
    }
  }

  return forkedMessages;
}

export function mainMenu(state: TUIState, initialPane = "main") {
  type MenuPane = Omit<SelectOptions, "onCancel" | "onSelect">;

  const oauthProviders = getOAuthProviders();
  const getProviderLabel = (provider: string) =>
    oauthProviders.find((oauthProvider) => oauthProvider.id === provider)
      ?.name ?? provider;
  const reasoningEfforts: ThinkingLevel[] = [
    "minimal",
    "low",
    "medium",
    "high",
    "xhigh",
  ];
  const efforts = reasoningEfforts.map((v) => ({ label: v, value: v }));
  const getProviderModelOptions = (provider: string) =>
    getProviderModels(provider, state.options.customProviders).map((v) => ({
      label: v.name,
      value: v.id,
    }));

  let currentProviders: string[] = [];
  let currentSessions: Session[] = [];

  const providersPane = async (): Promise<MenuPane> => {
    const builtIn = await getAvailableProviders();
    const custom =
      state.options.customProviders?.map((cp) => cp.provider) ?? [];
    currentProviders = [...new Set([...builtIn, ...custom])];
    return {
      label: "providers",
      filter: "",
      list: currentProviders.map((provider) => ({
        label: getProviderLabel(provider),
        value: provider,
      })),
    };
  };

  const sessionsPane = async (): Promise<MenuPane> => {
    currentSessions = await listSessionsForCwd();
    return {
      label: "sessions",
      filter: "",
      list: currentSessions.map((session) => ({
        label: sessionLabel(session),
        value: session.id,
      })),
    };
  };

  const forkPane = (): MenuPane => ({
    label: "fork",
    filter: "",
    list: state.messages.map((message, index) => ({
      label: messageLabel(message, index),
      value: String(index),
    })),
  });

  const mainPane: MenuPane = {
    label: "main",
    filter: state.prompt.length ? state.prompt : "",
    list: [
      { label: "models and providers", value: "providers" },
      { label: "reasoning effort", value: "effort" },
      { label: "sessions", value: "sessions" },
      { label: "fork", value: "fork" },
    ],
  };
  const effortPane: MenuPane = {
    label: "effort",
    filter: "",
    list: efforts,
  };
  const panes: MenuPane[] = [effortPane];
  let currentPane = initialPane === "fork" ? forkPane() : mainPane;
  let selectedProvider: string | undefined;

  const openPane = (s: SelectState, pane: MenuPane) => {
    currentPane = pane;
    s.value = pane.filter;
    s.label = pane.label ? pane.label.toUpperCase() : "SELECT";
    s.list = pane.list;
    s.selected = s.list.length ? s.list[0].value : "";
  };

  const resetMenu = (s: SelectState) => {
    currentPane = mainPane;
    selectedProvider = undefined;
    currentProviders = [];
    currentSessions = [];
    s.value = "";
    s.label = mainPane.label ? mainPane.label.toUpperCase() : "SELECT";
    s.list = mainPane.list;
    s.selected = s.list.length ? s.list[0].value : "";
  };

  const closeMenu = (s: SelectState) => {
    resetMenu(s);
    state.overlay = false;
  };

  const toTUIMessage = (msg: Message) => {
    const textFromContent = (
      content: string | { type: string; text?: string }[],
    ) =>
      typeof content === "string"
        ? content
        : content
            .filter((c) => c.type === "text")
            .map((c) => c.text ?? "")
            .join("")
            .trim();

    if (msg.role === "user") {
      return {
        timestamp: formatTimestamp(msg.timestamp),
        role: "user" as const,
        text: textFromContent(msg.content)
          .replaceAll(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "")
          .trim(),
      };
    } else {
      const text = msg.content
        .filter((c) => c.type === "text")
        .map((c) => c.text)
        .join("")
        .trim();
      const thinking = msg.content
        .filter((c) => c.type === "thinking")
        .map((c) => c.thinking)
        .join("")
        .trim();
      const toolCalls = msg.content
        .filter((c) => c.type === "toolCall")
        .map((c) => {
          const toolResult = state.messages.find(
            (m) => m.role === "toolResult" && m.toolCallId === c.id,
          );
          return {
            id: c.id,
            tool: c.name,
            args: c.arguments,
            output: toolResult ? textFromContent(toolResult.content) : "",
          };
        });

      return {
        timestamp: formatTimestamp(msg.timestamp),
        role: "assistant" as const,
        text,
        thinking,
        toolCalls,
      };
    }
  };

  const select = useSelectOverlay({
    ...currentPane,
    onSelect: (s) => {
      if (!s.selected) return;

      if (currentPane.label === "main") {
        if (s.selected === "providers") {
          return providersPane().then((pane) => {
            openPane(s, pane);
          });
        }

        if (s.selected === "sessions") {
          return sessionsPane().then((pane) => {
            openPane(s, pane);
          });
        }

        if (s.selected === "fork") {
          openPane(s, forkPane());
          return;
        }

        const nextPane = panes.find((pane) => pane.label === s.selected);
        if (nextPane) openPane(s, nextPane);
        return;
      }

      if (currentPane.label === "sessions") {
        const session = currentSessions.find((v) => v.id === s.selected);
        if (!session) return;

        state.sessionId = session.id;
        state.messages = session.messages;
        state.tuiMessages = session.messages
          .filter((message) => message.role !== "toolResult")
          .map(toTUIMessage);
        state.prompt = "";
        state.contextSize = estimateTokens(JSON.stringify(state.messages));
        state.scrollOffset = 0;
        state.stickToBottom = true;
        closeMenu(s);
        return;
      }

      if (currentPane.label === "fork") {
        const selectedIndex = Number(s.selected);
        if (
          !Number.isInteger(selectedIndex) ||
          !state.messages[selectedIndex]
        ) {
          return;
        }

        state.sessionId = undefined;
        state.messages = forkMessages(state.messages, selectedIndex);
        state.tuiMessages = state.messages
          .filter((message) => message.role !== "toolResult")
          .map(toTUIMessage);
        state.prompt = "";
        state.contextSize = estimateTokens(JSON.stringify(state.messages));
        state.scrollOffset = 0;
        state.stickToBottom = true;
        closeMenu(s);
        return;
      }

      if (currentPane.label === "providers") {
        const provider = currentProviders.find((v) => v === s.selected);
        if (!provider) return;

        selectedProvider = provider;
        openPane(s, {
          label: "models",
          filter: "",
          list: getProviderModelOptions(selectedProvider),
        });
        return;
      }

      if (currentPane.label === "models") {
        if (!selectedProvider) return;

        const model = findModelConfig(
          s.selected,
          selectedProvider,
          state.options.customProviders,
        );
        if (!model) return;

        state.options.provider = selectedProvider;
        state.options.model = model;
        saveSettings({
          provider: selectedProvider,
          model: model.id,
          effort: state.options.effort,
          customProviders: state.options.customProviders,
        });
        closeMenu(s);
        return;
      }

      if (currentPane.label === "effort") {
        const effort = reasoningEfforts.find((v) => v === s.selected);
        if (!effort) return;

        state.options.effort = effort;
        saveSettings({
          provider: state.options.provider,
          model: state.options.model.id,
          effort: effort,
          customProviders: state.options.customProviders,
        });
        closeMenu(s);
      }
    },
    onCancel: () => {
      currentPane = mainPane;
      selectedProvider = undefined;
      currentProviders = [];
      currentSessions = [];
      state.overlay = false;
    },
  });

  return select;
}
