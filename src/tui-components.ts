import { type Color, HStack, Text } from "@cel-tui/core";
import { onceEvery } from "./shared";
import type { TUIState } from "./types";

export const theme = {
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

export function TextPill(
  content: string,
  fgColor: Color,
  bgColor: Color,
  size?: number | undefined,
) {
  return HStack({ gap: 1, width: size }, [
    HStack({ bgColor, padding: { x: 1 } }, [
      Text(content, { bold: true, fgColor }),
    ]),
  ]);
}

export function Spinner() {
  const spinnerFrames = [
    "⠁",
    "⠂",
    "⠄",
    "⡀",
    "⡈",
    "⡐",
    "⡠",
    "⣀",
    "⣁",
    "⣂",
    "⣄",
    "⣌",
    "⣔",
    "⣤",
    "⣥",
    "⣦",
    "⣮",
    "⣶",
    "⣷",
    "⣿",
    "⡿",
    "⠿",
    "⢟",
    "⠟",
    "⡛",
    "⠛",
    "⠫",
    "⢋",
    "⠋",
    "⠍",
    "⡉",
    "⠉",
    "⠑",
    "⠡",
    "⢁",
  ];
  let spinnerTick = 0;
  const spinnerEvery = onceEvery(4, () => spinnerTick++);
  const currentSpinner = () =>
    spinnerFrames[spinnerTick % spinnerFrames.length];

  return { spinnerEvery, currentSpinner };
}

export function ActivityPill(state: TUIState, spinnerFrame: string) {
  let label = "idle";
  const frame = state.streaming ? spinnerFrame : "";

  if (frame) {
    label = frame;
  }

  return Text(label);
}

export function ContextPill(state: TUIState) {
  let text = "";
  let bg = theme.bwhite;
  if (!state.contextSize) {
    text = "0%";
  } else {
    const max = state.options.model.contextWindow;
    const percent = Math.floor((state.contextSize / max) * 100);
    if (percent > 90) {
      bg = theme.bred;
    } else if (percent > 75) {
      bg = theme.red;
    } else if (percent > 60) {
      bg = theme.yellow;
    } else if (percent > 40) {
      bg = theme.byellow;
    }
    text = `~${percent}%`;
  }

  text += ` (${state.options.model.contextWindow / 1000}k)`;

  return TextPill(text, theme.bblack, bg);
}

export function GitPill(state: TUIState) {
  return TextPill(state.gitBranch ?? "No git.", theme.bwhite, theme.bblack);
}

export function ModelPill(state: TUIState) {
  // Like loot: Gold/purple/blue/green/white -> xhigh/high/medium/low/minimal
  switch (state.options.effort) {
    case "xhigh":
      return TextPill(state.options.model.name, theme.white, theme.yellow);
    case "high":
      return TextPill(state.options.model.name, theme.white, theme.magenta);
    case "medium":
      return TextPill(state.options.model.name, theme.white, theme.blue);
    case "low":
      return TextPill(state.options.model.name, theme.white, theme.green);
  }
  // Minimal
  return TextPill(state.options.model.name, theme.bwhite, theme.bblack);
}
