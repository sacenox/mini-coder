import { HStack, Text, TextInput, VStack } from "@cel-tui/core";
import {
  getModels,
  type KnownProvider,
  type ThinkingLevel,
} from "@mariozechner/pi-ai";
import { getOAuthProviders } from "@mariozechner/pi-ai/oauth";
import { getAvailableProviders } from "./oauth";
import { listSessionsForCwd } from "./session";
import { TextPill, theme } from "./tui-components";
import type { SelectOptions, SelectState, Session, TUIState } from "./types";
import { estimateTokens } from "./shared";

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
  const snippet = text.trim().replace(/\s+/g, " ").slice(0, 80);

  return snippet || session.id;
}

export function mainMenu(state: TUIState) {
  type MenuPane = Omit<SelectOptions, "onCancel" | "onSelect">;

  const oauthProviders = getOAuthProviders();
  const getProviderLabel = (provider: KnownProvider) =>
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
  const getProviderModels = (provider: KnownProvider) =>
    getModels(provider).map((v) => ({
      label: v.name,
      value: v.id,
    }));

  let currentProviders: KnownProvider[] = [];
  let currentSessions: Session[] = [];

  const providersPane = async (): Promise<MenuPane> => {
    currentProviders = await getAvailableProviders();
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

  const mainPane: MenuPane = {
    label: "main",
    filter: state.prompt.length ? state.prompt : "",
    list: [
      { label: "models and providers", value: "providers" },
      { label: "reasoning effort", value: "effort" },
      { label: "sessions", value: "sessions" },
    ],
  };
  const effortPane: MenuPane = {
    label: "effort",
    filter: "",
    list: efforts,
  };
  const panes: MenuPane[] = [effortPane];
  let currentPane = mainPane;
  let selectedProvider: KnownProvider | undefined;

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

  const select = useSelectOverlay({
    ...mainPane,
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

        const nextPane = panes.find((pane) => pane.label === s.selected);
        if (nextPane) openPane(s, nextPane);
        return;
      }

      if (currentPane.label === "sessions") {
        const session = currentSessions.find((v) => v.id === s.selected);
        if (!session) return;

        state.sessionId = session.id;
        state.messages = session.messages;
        state.prompt = "";
        state.contextSize = estimateTokens(JSON.stringify(state.messages))
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
          list: getProviderModels(selectedProvider),
        });
        return;
      }

      if (currentPane.label === "models") {
        if (!selectedProvider) return;

        const model = getModels(selectedProvider).find(
          (v) => v.id === s.selected,
        );
        if (!model) return;

        state.options.provider = selectedProvider;
        state.options.model = model;
        closeMenu(s);
        return;
      }

      if (currentPane.label === "effort") {
        const effort = reasoningEfforts.find((v) => v === s.selected);
        if (!effort) return;

        state.options.effort = effort;
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
