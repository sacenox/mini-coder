import { Select, type SelectInstance } from "@cel-tui/components";
import { cel, HStack, Text, VStack } from "@cel-tui/core";
import type { Message, ThinkingLevel } from "@earendil-works/pi-ai";
import { getOAuthProviders } from "@earendil-works/pi-ai/oauth";
import { saveSettings } from "./args";
import { findModelConfig, getProviderModels } from "./models.ts";
import { getAvailableProviders } from "./oauth";
import { listSessionsForCwd } from "./session";
import { estimateContextTokens, formatTimestamp } from "./shared";
import { getTUITheme, TUI_THEME_IDS } from "./themes";
import { TextPill, theme } from "./tui-components";
import type { Session, TUIState } from "./types";

function SelectOverlay(label: string, select: SelectInstance) {
  return VStack({ height: "100%", justifyContent: "end" }, [
    VStack(
      {
        width: "100%",
        bgColor: theme.white,
        fgColor: theme.bblack,
        gap: 1,
        padding: { x: 1, y: 1 },
      },
      [
        HStack({ width: "100%" }, [
          TextPill(label.toUpperCase(), theme.bwhite, theme.bblack),
        ]),
        select(),
      ],
    ),
  ]);
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
  type MenuPane = {
    label: string;
    filter: string;
    list: { label: string; value: string }[];
  };

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

  const themesPane = (): MenuPane => ({
    label: "themes",
    filter: "",
    list: TUI_THEME_IDS.map((id) => {
      const tuiTheme = getTUITheme(id);
      return {
        label:
          id === state.options.theme
            ? `${tuiTheme.label} (current)`
            : tuiTheme.label,
        value: id,
      };
    }),
  });

  const mainPane: MenuPane = {
    label: "main",
    filter: state.prompt.length ? state.prompt : "",
    list: [
      { label: "models and providers", value: "providers" },
      { label: "reasoning effort", value: "effort" },
      { label: "themes", value: "themes" },
      { label: "sessions", value: "sessions" },
      { label: "fork", value: "fork" },
    ],
  };
  const effortPane: MenuPane = {
    label: "effort",
    filter: "",
    list: efforts,
  };
  const panes: MenuPane[] = [effortPane, themesPane()];
  let currentPane = initialPane === "fork" ? forkPane() : mainPane;
  let selectedProvider: string | undefined;
  let select: SelectInstance;

  const openPane = (pane: MenuPane) => {
    currentPane = pane;
    select.update({
      items: pane.list,
      query: pane.filter,
      cursor: pane.filter.length,
      highlightIndex: 0,
    });
  };

  const resetMenu = () => {
    currentPane = mainPane;
    selectedProvider = undefined;
    currentProviders = [];
    currentSessions = [];
  };

  const closeMenu = () => {
    resetMenu();
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

  select = Select({
    items: currentPane.list,
    initialQuery: currentPane.filter,
    stateKey: "menu-filter-input",
    maxVisible: 20,
    searchLabel: "",
    placeholder: "Search...",
    highlightColor: theme.black,
    fgColor: theme.bblack,
    bgColor: theme.white,
    autoFocus: true,
    filter: (items, query) =>
      query ? items.filter((item) => item.filterText.includes(query)) : items,
    renderRow: (item, { highlighted }) =>
      Text(item.label, {
        fgColor: highlighted ? theme.black : theme.bblack,
      }),
    onSelect: (selected) => {
      if (currentPane.label === "main") {
        if (selected === "providers") {
          select.update({ query: "", cursor: 0, highlightIndex: 0 });
          void providersPane()
            .then(openPane)
            .catch(() => openPane(mainPane));
          return;
        }

        if (selected === "sessions") {
          select.update({ query: "", cursor: 0, highlightIndex: 0 });
          void sessionsPane()
            .then(openPane)
            .catch(() => openPane(mainPane));
          return;
        }

        if (selected === "fork") {
          openPane(forkPane());
          return;
        }

        const nextPane = panes.find((pane) => pane.label === selected);
        if (nextPane) openPane(nextPane);
        return;
      }

      if (currentPane.label === "sessions") {
        const session = currentSessions.find((v) => v.id === selected);
        if (!session) return;

        state.sessionId = session.id;
        state.messages = session.messages;
        state.tuiMessages = session.messages
          .filter((message) => message.role !== "toolResult")
          .map(toTUIMessage);
        state.prompt = "";
        state.contextSize = estimateContextTokens(state.messages);
        state.scrollOffset = 0;
        state.stickToBottom = true;
        closeMenu();
        return;
      }

      if (currentPane.label === "fork") {
        const selectedIndex = Number(selected);
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
        state.contextSize = estimateContextTokens(state.messages);
        state.scrollOffset = 0;
        state.stickToBottom = true;
        closeMenu();
        return;
      }

      if (currentPane.label === "themes") {
        const nextTheme = TUI_THEME_IDS.find((id) => id === selected);
        if (!nextTheme) return;

        state.options.theme = nextTheme;
        cel.setTheme(getTUITheme(nextTheme).palette);
        saveSettings({
          provider: state.options.provider,
          model: state.options.model.id,
          effort: state.options.effort,
          customProviders: state.options.customProviders,
          theme: nextTheme,
        });
        closeMenu();
        return;
      }

      if (currentPane.label === "providers") {
        const provider = currentProviders.find((v) => v === selected);
        if (!provider) return;

        selectedProvider = provider;
        openPane({
          label: "models",
          filter: "",
          list: getProviderModelOptions(selectedProvider),
        });
        return;
      }

      if (currentPane.label === "models") {
        if (!selectedProvider) return;

        const model = findModelConfig(
          selected,
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
          theme: state.options.theme,
        });
        closeMenu();
        return;
      }

      if (currentPane.label === "effort") {
        const effort = reasoningEfforts.find((v) => v === selected);
        if (!effort) return;

        state.options.effort = effort;
        saveSettings({
          provider: state.options.provider,
          model: state.options.model.id,
          effort: effort,
          customProviders: state.options.customProviders,
          theme: state.options.theme,
        });
        closeMenu();
      }
    },
    onCancel: () => {
      resetMenu();
      state.overlay = false;
    },
    onKeyPress: (key) => {
      if (key === "ctrl+p") {
        resetMenu();
        state.overlay = false;
        return;
      }

      return false;
    },
  });

  return () => SelectOverlay(currentPane.label, select);
}
