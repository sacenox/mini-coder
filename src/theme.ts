import { createThemeDefinition, rgb } from "@rezi-ui/core";

export const themes = {
  default: createThemeDefinition("default", {
    bg: {
      base: rgb(20, 20, 30),
      elevated: rgb(28, 28, 40),
      overlay: rgb(36, 36, 52),
      subtle: rgb(24, 24, 36),
    },
    fg: {
      primary: rgb(220, 220, 220),
      secondary: rgb(170, 170, 190),
      muted: rgb(120, 120, 140),
      inverse: rgb(20, 20, 30),
    },
    accent: {
      primary: rgb(100, 180, 255),
      secondary: rgb(180, 100, 255),
      tertiary: rgb(120, 220, 180),
    },
    success: rgb(100, 220, 100),
    warning: rgb(255, 200, 50),
    error: rgb(255, 100, 100),
    info: rgb(100, 200, 255),
    focus: { ring: rgb(100, 180, 255), bg: rgb(32, 36, 48) },
    selected: { bg: rgb(40, 52, 72), fg: rgb(220, 220, 220) },
    disabled: { fg: rgb(120, 120, 140), bg: rgb(28, 28, 40) },
    diagnostic: {
      error: rgb(255, 100, 100),
      warning: rgb(255, 200, 50),
      info: rgb(100, 200, 255),
      hint: rgb(120, 220, 180),
    },
    border: {
      subtle: rgb(36, 36, 52),
      default: rgb(80, 80, 96),
      strong: rgb(120, 120, 140),
    },
  }),
};
