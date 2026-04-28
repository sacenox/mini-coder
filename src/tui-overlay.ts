import { HStack, Text, TextInput, VStack } from "@cel-tui/core";
import {
  getModels,
  type KnownProvider,
  type ThinkingLevel,
} from "@mariozechner/pi-ai";
import { getOAuthProviders } from "@mariozechner/pi-ai/oauth";
import { TextPill, theme } from "./tui-components";
import type { SelectOptions, SelectState, TUIState } from "./types";

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
      s.value = "";
      initialOptions.onSelect(s);
      if (s.list !== previousList) {
        baseList = s.list;
      } else {
        s.list = previousBaseList;
        s.selected = s.list.length ? s.list[0].value : "";
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

export function mainMenu(state: TUIState) {
  type MenuPane = Omit<SelectOptions, "onCancel" | "onSelect">;

  const oauthProviders = getOAuthProviders();
  const providers = oauthProviders.map((v) => ({
    label: v.name,
    value: v.id,
  }));
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

  const mainPane: MenuPane = {
    label: "main",
    filter: state.prompt.length ? state.prompt : "",
    list: [
      { label: "models and providers", value: "providers" },
      { label: "reasoning effort", value: "effort" },
    ],
  };
  const providersPane: MenuPane = {
    label: "providers",
    filter: "",
    list: providers,
  };
  const effortPane: MenuPane = {
    label: "effort",
    filter: "",
    list: efforts,
  };
  const panes: MenuPane[] = [mainPane, providersPane, effortPane];
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
        const nextPane = panes.find((pane) => pane.label === s.selected);
        if (nextPane) openPane(s, nextPane);
        return;
      }

      if (currentPane.label === "providers") {
        const provider = oauthProviders.find((v) => v.id === s.selected);
        if (!provider) return;

        selectedProvider = provider.id as KnownProvider;
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
      state.overlay = false;
    },
  });

  return select;
}
