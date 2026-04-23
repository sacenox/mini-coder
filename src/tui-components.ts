import { type Color, HStack, Text } from "@cel-tui/core";

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

// Examples:
//
// TextPill("mini-coder", theme.bblack, theme.black),
// TextPill("mini-coder", theme.bred, theme.red),
// TextPill("mini-coder", theme.bgreen, theme.green),
// TextPill("mini-coder", theme.byellow, theme.yellow),
// TextPill("mini-coder", theme.bblue, theme.blue),
// TextPill("mini-coder", theme.bmagenta, theme.magenta),
// TextPill("mini-coder", theme.bcyan, theme.cyan),
// TextPill("mini-coder", theme.bwhite, theme.white),
export function TextPill(content: string, fgColor: Color, bgColor: Color) {
  return HStack({ gap: 1 }, [
    HStack({ bgColor, padding: { x: 1 } }, [
      Text(content, { bold: true, fgColor }),
    ]),
  ]);
}

// const spinnerFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
// let spinnerTick = 0;
// let spinnerTimer: ReturnType<typeof setInterval> | null = null;

// function startSpinner() {
//   stopSpinner();
//   spinnerTimer = setInterval(() => {
//     spinnerTick++;
//     cel.render();
//   }, 80);
// }

// function stopSpinner() {
//   if (spinnerTimer) {
//     clearInterval(spinnerTimer);
//     spinnerTimer = null;
//   }
// }

// function currentSpinner(): string {
//   return spinnerFrames[spinnerTick % spinnerFrames.length]!;
// }
