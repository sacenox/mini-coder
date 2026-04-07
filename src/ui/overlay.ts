/**
 * Overlay rendering primitives for the terminal UI.
 *
 * @module
 */

import type { SelectInstance } from "@cel-tui/components";
import { Text, VStack } from "@cel-tui/core";
import type { Node } from "@cel-tui/types";
import type { Theme } from "../theme.ts";

/** Max visible items in the overlay Select. */
export const OVERLAY_MAX_VISIBLE = 15;

/** Horizontal padding around the overlay modal. */
export const OVERLAY_PADDING_X = 4;

/** Active overlay for interactive commands such as `/model` and `/session`. */
export interface ActiveOverlay {
  /** The Select component instance. */
  select: SelectInstance;
  /** Title displayed above the Select. */
  title: string;
}

/**
 * Render the centered overlay modal for an active Select.
 *
 * @param theme - Active UI theme.
 * @param overlay - Overlay title and Select instance to render.
 * @returns The overlay node.
 */
export function renderOverlay(theme: Theme, overlay: ActiveOverlay): Node {
  const modalHeight = OVERLAY_MAX_VISIBLE + 3;

  return VStack(
    {
      height: "100%",
      justifyContent: "center",
      padding: { x: OVERLAY_PADDING_X },
    },
    [
      VStack(
        {
          height: modalHeight,
          bgColor: theme.overlayBg,
          padding: { x: 1 },
        },
        [
          Text(overlay.title, {
            bold: true,
            fgColor: theme.accentText,
          }),
          overlay.select(),
        ],
      ),
    ],
  );
}
