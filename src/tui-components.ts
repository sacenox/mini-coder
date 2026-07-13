import { Spinner as CelSpinner } from "@cel-tui/components";
import { type Color, HStack, Text } from "@cel-tui/core";
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

export function Spinner(onFrame?: (frame: string) => void) {
  return CelSpinner({
    frames: [
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
    ],
    maxFps: 15,
    onFrame,
  });
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
    const max = state.options.model.contextWindow;
    const percent = Math.floor((state.contextSize / max) * 100);
    if (percent > 90) {
      bg = theme.bred;
    } else if (percent > 85) {
      bg = theme.red;
    } else if (percent > 80) {
      bg = theme.yellow;
    } else if (percent > 60) {
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
