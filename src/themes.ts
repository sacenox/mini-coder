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

const ANSI_SLOT_HEX: Record<Color, string> = {
  color00: "#000000",
  color01: "#cd3131",
  color02: "#0dbc79",
  color03: "#e5e510",
  color04: "#2472c8",
  color05: "#bc3fbc",
  color06: "#11a8cd",
  color07: "#e5e5e5",
  color08: "#666666",
  color09: "#f14c4c",
  color10: "#23d18b",
  color11: "#f5f543",
  color12: "#3b8eea",
  color13: "#d670d6",
  color14: "#29b8db",
  color15: "#ffffff",
};

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

const slotColor = (slot: Color) => ANSI_SLOT_HEX[slot];

function syntaxScope(
  scope: string | readonly string[],
  foreground: Color,
  fontStyle?: string,
) {
  return {
    scope,
    settings: {
      foreground: slotColor(foreground),
      ...(fontStyle ? { fontStyle } : {}),
    },
  };
}

const molokaiDarkSyntax = {
  name: "mini-coder-molokai-dark",
  type: "dark",
  fg: slotColor("color07"),
  tokenColors: [
    syntaxScope(["comment", "markup.quote"], "color08", "italic"),
    syntaxScope(["keyword", "operator"], "color05"),
    syntaxScope(["string", "escape", "markup.list"], "color03"),
    syntaxScope(["number", "regexp"], "color13"),
    syntaxScope(["function", "command", "markup.code"], "color10"),
    syntaxScope(["builtin", "property", "type", "meta"], "color06"),
    syntaxScope("markup.heading", "color04", "bold"),
    syntaxScope(["diff.deleted", "diff.file.old"], "color09"),
    syntaxScope(["diff.inserted", "diff.file.new"], "color10"),
    syntaxScope("diff.hunk", "color13"),
    syntaxScope(["diff.header", "diff.no-newline"], "color08"),
  ],
} as const satisfies SyntaxHighlightTheme;

const molokaiLightSyntax = {
  name: "mini-coder-molokai-light",
  type: "light",
  fg: slotColor("color00"),
  tokenColors: [
    syntaxScope(["comment", "markup.quote"], "color08", "italic"),
    syntaxScope(["keyword", "operator"], "color13"),
    syntaxScope(["string", "escape", "markup.list"], "color11"),
    syntaxScope(["number", "regexp"], "color09"),
    syntaxScope(["function", "command", "markup.code"], "color10"),
    syntaxScope(["builtin", "property", "type", "meta"], "color14"),
    syntaxScope("markup.heading", "color12", "bold"),
    syntaxScope(["diff.deleted", "diff.file.old"], "color09"),
    syntaxScope(["diff.inserted", "diff.file.new"], "color10"),
    syntaxScope("diff.hunk", "color13"),
    syntaxScope(["diff.header", "diff.no-newline"], "color08"),
  ],
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
