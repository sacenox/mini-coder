import type { SyntaxHighlightTheme } from "@cel-tui/components";
import type { Color, Theme } from "@cel-tui/core";

export const TUI_THEME_IDS = [
  "ansi16",
  "molokai-dark",
  "molokai-light",
] as const;

export type TUIThemeId = (typeof TUI_THEME_IDS)[number];

export interface TUIThemeDefinition {
  id: TUIThemeId;
  label: string;
  palette: Theme;
  syntax: SyntaxHighlightTheme;
  rootFgColor?: Color;
  rootBgColor?: Color;
  userMessageBgColor?: Color;
}

export const theme = {
  black: "color00",
  red: "color01",
  green: "color02",
  yellow: "color03",
  blue: "color04",
  magenta: "color05",
  cyan: "color06",
  white: "color07",
  bblack: "color08",
  bred: "color09",
  bgreen: "color10",
  byellow: "color11",
  bblue: "color12",
  bmagenta: "color13",
  bcyan: "color14",
  bwhite: "color15",
} as const satisfies Record<string, Color>;

const ansi16Palette: Theme = {
  color00: 0,
  color01: 1,
  color02: 2,
  color03: 3,
  color04: 4,
  color05: 5,
  color06: 6,
  color07: 7,
  color08: 8,
  color09: 9,
  color10: 10,
  color11: 11,
  color12: 12,
  color13: 13,
  color14: 14,
  color15: 15,
};

const molokaiDarkPalette: Theme = {
  color00: "#272822",
  color01: "#f92672",
  color02: "#a6e22e",
  color03: "#e6db74",
  color04: "#66d9ef",
  color05: "#f92672",
  color06: "#66d9ef",
  color07: "#f8f8f2",
  color08: "#6f705f",
  color09: "#ff6188",
  color10: "#a6e22e",
  color11: "#ffd866",
  color12: "#78dce8",
  color13: "#ae81ff",
  color14: "#66d9ef",
  color15: "#ffffff",
};

const molokaiLightPalette: Theme = {
  color00: "#272822",
  color01: "#ff5f87",
  color02: "#8bcf26",
  color03: "#c7a100",
  color04: "#61aeee",
  color05: "#d16dff",
  color06: "#00a8b5",
  color07: "#f2efe4",
  color08: "#5f6060",
  color09: "#b0003a",
  color10: "#3f7d00",
  color11: "#725f00",
  color12: "#005f9f",
  color13: "#7f2caf",
  color14: "#007885",
  color15: "#fffdf5",
};

const molokaiDarkSyntax = {
  baseStyle: { fgColor: theme.white },
  scopeStyles: {
    comment: { fgColor: theme.bblack, italic: true },
    "markup.quote": { fgColor: theme.bblack, italic: true },
    keyword: { fgColor: theme.magenta },
    operator: { fgColor: theme.magenta },
    string: { fgColor: theme.yellow },
    escape: { fgColor: theme.yellow },
    "markup.list": { fgColor: theme.yellow },
    number: { fgColor: theme.bmagenta },
    regexp: { fgColor: theme.bmagenta },
    function: { fgColor: theme.bgreen },
    command: { fgColor: theme.bgreen },
    "markup.code": { fgColor: theme.bgreen },
    builtin: { fgColor: theme.cyan },
    property: { fgColor: theme.cyan },
    type: { fgColor: theme.cyan },
    meta: { fgColor: theme.cyan },
    "markup.heading": { fgColor: theme.blue, bold: true },
    "diff.deleted": { fgColor: theme.bred },
    "diff.file.old": { fgColor: theme.bred },
    "diff.inserted": { fgColor: theme.bgreen },
    "diff.file.new": { fgColor: theme.bgreen },
    "diff.hunk": { fgColor: theme.bmagenta },
    "diff.header": { fgColor: theme.bblack },
    "diff.no-newline": { fgColor: theme.bblack },
  },
} as const satisfies SyntaxHighlightTheme;

const molokaiLightSyntax = {
  baseStyle: { fgColor: theme.black },
  scopeStyles: {
    comment: { fgColor: theme.bblack, italic: true },
    "markup.quote": { fgColor: theme.bblack, italic: true },
    keyword: { fgColor: theme.bmagenta },
    operator: { fgColor: theme.bmagenta },
    string: { fgColor: theme.byellow },
    escape: { fgColor: theme.byellow },
    "markup.list": { fgColor: theme.byellow },
    number: { fgColor: theme.bred },
    regexp: { fgColor: theme.bred },
    function: { fgColor: theme.bgreen },
    command: { fgColor: theme.bgreen },
    "markup.code": { fgColor: theme.bgreen },
    builtin: { fgColor: theme.bcyan },
    property: { fgColor: theme.bcyan },
    type: { fgColor: theme.bcyan },
    meta: { fgColor: theme.bcyan },
    "markup.heading": { fgColor: theme.bblue, bold: true },
    "diff.deleted": { fgColor: theme.bred },
    "diff.file.old": { fgColor: theme.bred },
    "diff.inserted": { fgColor: theme.bgreen },
    "diff.file.new": { fgColor: theme.bgreen },
    "diff.hunk": { fgColor: theme.bmagenta },
    "diff.header": { fgColor: theme.bblack },
    "diff.no-newline": { fgColor: theme.bblack },
  },
} as const satisfies SyntaxHighlightTheme;

export const DEFAULT_TUI_THEME_ID: TUIThemeId = "ansi16";

export const TUI_THEMES = {
  ansi16: {
    id: "ansi16",
    label: "ansi16",
    palette: ansi16Palette,
    syntax: "default",
    userMessageBgColor: theme.bblack,
  },
  "molokai-dark": {
    id: "molokai-dark",
    label: "molokai dark",
    palette: molokaiDarkPalette,
    syntax: molokaiDarkSyntax,
    rootFgColor: theme.bwhite,
    rootBgColor: theme.black,
    userMessageBgColor: theme.bblack,
  },
  "molokai-light": {
    id: "molokai-light",
    label: "molokai light",
    palette: molokaiLightPalette,
    syntax: molokaiLightSyntax,
    rootFgColor: theme.black,
    rootBgColor: theme.bwhite,
    userMessageBgColor: theme.white,
  },
} as const satisfies Record<TUIThemeId, TUIThemeDefinition>;

export function getTUITheme(id: TUIThemeId): TUIThemeDefinition {
  return TUI_THEMES[id];
}

export function textColorForBackground(
  bgColor: Color,
  themeId: TUIThemeId,
): Color {
  if (bgColor === theme.bblack) return theme.bwhite;

  if (
    themeId === "molokai-light" &&
    (
      [
        theme.bred,
        theme.bgreen,
        theme.byellow,
        theme.bblue,
        theme.bmagenta,
        theme.bcyan,
      ] as readonly Color[]
    ).includes(bgColor)
  ) {
    return theme.bwhite;
  }

  return theme.black;
}
