import { type Color, HStack, Text } from "@cel-tui/core";
import { onceEvery } from "./shared";
import { textColorForBackground, theme } from "./themes";
import type { TUIState } from "./types";

export { theme };

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
  let label = "";
  const frame = state.streaming ? spinnerFrame : "";

  if (frame) {
    label = frame;
  }

  return Text(label);
}

export function ContextPill(state: TUIState) {
  let text = "";
  let bg: Color = theme.bgreen;
  if (!state.contextSize) {
    text = "0%";
    bg = theme.bwhite;
  } else {
    // Colors show the progress in the "smart window" or how much
    // before the dumb zone. The user facing percentage is the model
    // amount. An elegant way to show both :)
    const max = state.options.model.contextWindow;
    const smartMax = 80000;
    const percent = Math.floor((state.contextSize / max) * 100);
    const smartPercent = Math.floor((state.contextSize / smartMax) * 100);
    if (smartPercent > 90) {
      bg = theme.bred;
    } else if (smartPercent > 85) {
      bg = theme.red;
    } else if (smartPercent > 80) {
      bg = theme.yellow;
    } else if (smartPercent > 60) {
      bg = theme.byellow;
    }
    text = `~${percent}%`;
  }

  text += ` (${state.options.model.contextWindow / 1000}k)`;

  return TextPill(text, textColorForBackground(bg, state.options.theme), bg);
}

export function GitPill(state: TUIState) {
  return TextPill(state.gitBranch ?? "No git.", theme.bwhite, theme.bblack);
}

export function ModelPill(state: TUIState) {
  // Like loot: Gold/purple/blue/green/white -> xhigh/high/medium/low/minimal
  switch (state.options.effort) {
    case "xhigh":
      return TextPill(state.options.model.name, theme.black, theme.yellow);
    case "high":
      return TextPill(state.options.model.name, theme.black, theme.magenta);
    case "medium":
      return TextPill(state.options.model.name, theme.black, theme.blue);
    case "low":
      return TextPill(state.options.model.name, theme.black, theme.green);
  }
  // Minimal
  return TextPill(state.options.model.name, theme.bwhite, theme.bblack);
}
