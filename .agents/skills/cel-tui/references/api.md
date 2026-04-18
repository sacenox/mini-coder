# cel-tui API Reference

## Framework lifecycle

```ts
cel.init(new ProcessTerminal(), { theme?: Theme });
cel.viewport(() => tree); // or () => [layer1, layer2]
cel.render();
cel.setTitle("My App");
cel.stop();
```

- `cel.viewport` sets the render function and triggers the first render.
- `cel.render()` requests a batched re-render after external state changes.
- `cel.setTitle(title)` writes a best-effort terminal title request. Control characters are stripped from `title`, and `cel.stop()` does not restore the previous title automatically.
- `cel.stop()` restores terminal state (raw mode, keyboard protocol, mouse tracking, alternate screen).

## Container Props

All props accepted by `VStack` and `HStack`:

```ts
{
  // Sizing
  width, height,          // SizeValue (number | "50%")
  flex,                   // number
  minWidth, maxWidth,     // number
  minHeight, maxHeight,   // number
  padding,                // { x?: number, y?: number }
  gap,                    // number (cells between children)
  justifyContent,         // "start" | "end" | "center" | "space-between"
  alignItems,             // "start" | "end" | "center" | "stretch"
  overflow,               // "hidden" (default) | "scroll"
  scrollbar,              // boolean
  scrollStep,             // number (mouse wheel step in cells; default adaptive)
  scrollOffset,           // number (controlled scroll)
  onScroll,               // (offset: number, maxOffset: number) => void
  flexWrap,               // "nowrap" (default) | "wrap" (HStack only)

  // Styling (inherited by descendants)
  bold, italic, underline,// boolean
  fgColor, bgColor,       // Color ("color00"–"color15")
  focusStyle,             // StyleProps — overrides when focused

  // Interaction
  onClick,                // () => void
  focusable,              // boolean (default true if onClick set, or set true explicitly)
  focused,                // boolean (controlled — omit for uncontrolled)
  onFocus,                // () => void
  onBlur,                 // () => void
  onKeyPress,             // (key: string) => boolean | void — normalized semantic key string; return false to keep bubbling
}
```

## Measurement Helpers

```ts
measureContentHeight(node, { width }); // number
```

- Measures a node tree's **intrinsic content height** at the provided wrapping width.
- This is a content-measurement helper, not a viewport/clipping helper.
- The provided `width` is authoritative — use the actual width the subtree wraps at.
- Main use case: prepend-style scrollback, where older content is inserted above the current viewport and the app needs to preserve the viewport anchor.

```ts
const addedHeight = measureContentHeight(
  VStack({}, olderMessages.map(renderMessage)),
  { width: historyContentWidth },
);

scrollOffset += addedHeight;
```

Measure the content subtree you are adding. If a wrapper's visible height is controlled by `height`, `flex`, or percentage sizing, measure the content inside that wrapper instead. For padded content, pass the outer width when measuring the padded container itself, or the inner content width when measuring its children directly.

## Scroll

Scroll supports **uncontrolled** (default) and **controlled** modes, mirroring the focus model:

```ts
// Uncontrolled — framework manages scroll position. Mouse wheel just works.
VStack({ overflow: "scroll", scrollbar: true }, [...items]);

// Controlled — app owns scroll state.
VStack(
  {
    overflow: "scroll",
    scrollbar: true,
    scrollOffset: offset,
    onScroll: (newOffset, maxOffset) => {
      offset = newOffset;
      cel.render();
    },
  },
  [...items],
);
```

- Scroll direction follows the container’s main axis: VStack → vertical, HStack → horizontal.
- Scroll is pointer-driven (mouse wheel), not focus-driven. A user can type in a focused widget while scrolling a different container.
- Mouse wheel scrolling uses an adaptive default step based on the scroll target's visible main-axis viewport size: `floor(viewportMainAxis / 3)`, clamped to `3..8`.
- Set `scrollStep` to override the mouse wheel step for a specific scrollable or `TextInput`.
- In controlled mode, the UI only moves when the app passes the updated `scrollOffset` back. `onScroll` fires with the clamped new offset and the maximum offset (content size minus viewport size). Pass `Infinity` as `scrollOffset` to mean "scroll to end" (clamped during rendering). `scrollStep` affects mouse wheel input only.

## Text Props

```ts
Text("content", {
  repeat: "fill" | number, // Repeat to fill width or N times
  wrap: "none" | "word", // Default "none", hard-clips at edge
  bold,
  italic,
  underline, // boolean
  fgColor,
  bgColor, // Color ("color00"–"color15")
});
```

Colors: 16 numbered palette slots — `"color00"` through `"color15"`. Mapped to ANSI 16 by default; custom themes can remap to different ANSI indices or 24-bit true color. Omit a color prop for the terminal default.

## TextInput Props

```ts
TextInput({
  value, // string (controlled)
  onChange, // (value: string) => void
  onKeyPress, // (key: string) => boolean | void — normalized semantic key string; return false to prevent default editing action
  placeholder, // Text() node shown when empty
  // + all container props (sizing, styling, focus, scrollStep, etc.)
});
```

Enter inserts a newline by default. Use `onKeyPress` to intercept keys before editing:

```ts
// Enter submits instead of inserting newline
TextInput({
  value: input,
  onChange: handleChange,
  onKeyPress: (key) => {
    if (key === "enter") {
      handleSend();
      return false;
    }
  },
});
```

When focused, TextInput consumes insertable text plus editing/navigation keys, including readline-style shortcuts: `ctrl+a` / `ctrl+e`, `alt+b` / `alt+f`, `ctrl+left` / `ctrl+right`, `ctrl+w`, and `alt+d`. Word movement and deletion are whitespace-delimited, and `up` / `down` navigate visual wrapped lines. Other modifier combos and non-insertable control keys bubble. Key strings are semantic identifiers for handlers, not necessarily the exact inserted text — uppercase `A` normalizes to key `"a"` while still inserting `"A"`.

## Sizing Strategies

Containers accept 4 sizing strategies:

```ts
VStack({}, []); // Intrinsic — size to fit content (default)
VStack({ width: 30, height: 10 }, []); // Fixed — exact cell count
VStack({ flex: 1 }, []); // Flex — proportional to siblings
VStack({ width: "50%", height: "100%" }, []); // Percentage — relative to parent
```

Constraints: `minWidth`, `maxWidth`, `minHeight`, `maxHeight`.

Text has no sizing props — parent controls the box, height is intrinsic (content + wrapping).

TextInput accepts container sizing props (`flex`, `width`, `height`, `padding`, `maxHeight`, etc.) plus container scroll props like `scrollStep` for mouse wheel behavior.

## Key Format

All lowercase, modifiers joined by `+`: `"ctrl+s"`, `"ctrl+shift+n"`, `"escape"`, `"enter"`, `"alt+up"`, `"f1"`. Framework normalizes modifier order.

cel-tui is **Kitty-first** and works well in `tmux` with `set -s extended-keys on`. Recoverable legacy forms normalize to the same key strings, but historically collapsed collisions (`ctrl+i` vs `tab`, `ctrl+m` vs `enter`, `ctrl+[` vs `escape`) remain limited by what the host terminal or multiplexer reports.

## Pre-made Components

```ts
import {
  Spacer,
  Divider,
  Button,
  Select,
  VDivider,
  Markdown,
  SyntaxHighlight,
} from "@cel-tui/components";

Spacer(); // VStack({ flex: 1 }, [])
Divider(); // Text("─", { repeat: "fill" })
Divider({ char: "═", fgColor: "color08" });
Button("[OK]", { onClick: handleOk });
Button("✕", { onClick: handleClose, focusable: false });
// Button accepts: onClick, focusable, focused, onFocus, onBlur, focusStyle,
// onKeyPress, padding, bold, fgColor, bgColor, italic, underline.
// Note: Button does not forward container sizing props (width, height, flex).
// For full layout control, use HStack + Text directly.
```

### Select (filterable list)

Select props: `items`, `onSelect`, `placeholder` (default `"type to filter..."`), `maxVisible` (default `10`), `indicator` (default `"›"`), `highlightColor` (default `"color06"`), `onKeyPress` (composed with internal handler), plus container/style props: `width`, `height`, `flex`, `fgColor`, `bgColor`, `focused`, `focusable`, `onFocus`, `onBlur`, `focusStyle`.

```ts
const mySelect = Select({
  items: ["apple", "banana", "cherry"],
  onSelect: (value) => {
    chosen = value;
    cel.render();
  },
  placeholder: "search fruits...",
  maxVisible: 8,
});

// Select returns false for unrecognized keys, so they bubble to root.
cel.viewport(() =>
  VStack(
    {
      height: "100%",
      onKeyPress: (key) => {
        if (key === "ctrl+q") {
          cel.stop();
          process.exit();
        }
      },
    },
    [Text("Pick a fruit:"), mySelect()],
  ),
);

// Reset state programmatically
mySelect.reset();
```

Rich items with separate display label, return value, and filter text:

```ts
const modelSelect = Select({
  items: [
    {
      label: "claude-sonnet-4  (free)",
      value: "anthropic/claude-sonnet-4",
      filterText: "claude-sonnet-4",
    },
    { label: "gpt-4o", value: "openai/gpt-4o", filterText: "gpt-4o" },
  ],
  onSelect: (value) => {
    model = value;
    cel.render();
  },
});
```

### VDivider (vertical divider)

```ts
import { VDivider } from "@cel-tui/components";

// Separate columns in an HStack
HStack({ height: "100%" }, [
  VStack({ flex: 1 }, [Text("left pane")]),
  VDivider({ fgColor: "color08" }),
  VStack({ flex: 1 }, [Text("right pane")]),
]);

// Custom character
VDivider({ char: "║", fgColor: "color08" });
```

### Markdown (rendered markdown)

Returns an array of nodes — spread into a container's children:

````ts
import { Markdown } from "@cel-tui/components";

VStack(
  { flex: 1, overflow: "scroll", padding: { x: 1 } },
  Markdown("# Hello\n\nSome **bold** text.\n\n```js\nconst x = 1;\n```"),
);
````

Custom theme for markdown styling:

```ts
Markdown(content, {
  theme: {
    heading1: { bold: true, fgColor: "color05" },
    codeBlock: { bgColor: "color08" },
    bold: { bold: true, fgColor: "color03" },
  },
});
```

Streaming works naturally — append chunks and call `cel.render()`. Unclosed blocks are handled gracefully.

### SyntaxHighlight (rendered code)

Returns a `VStack` — place it directly in a container's children:

```ts
import { SyntaxHighlight } from "@cel-tui/components";

VStack({ flex: 1, overflow: "scroll", padding: { x: 1 } }, [
  SyntaxHighlight(code, "typescript"),
]);

SyntaxHighlight(code, "javascript", { theme: "dark-plus" });
```

- Signature: `SyntaxHighlight(content, language, props?)`
- `language` accepts registered lextide language ids and aliases
- `props.theme` accepts the built-in presets (`"default"`, `"dark-plus"`) or a best-effort token theme registration object
- Uses a terminal-friendly ANSI 16 fallback theme by default
- Highlighting is synchronous at the component boundary; unsupported languages render plain text
- Content changes re-highlight the full snippet so final output stays stable across streamed chunk boundaries

## Theme

The default theme maps 16 color slots to ANSI palette indices. Custom themes remap to different ANSI indices or 24-bit hex:

```ts
import { cel, ProcessTerminal, type Theme } from "@cel-tui/core";

const mocha: Theme = {
  color00: "#1e1e2e",
  color01: "#f38ba8",
  color02: "#a6e3a1",
  color03: "#f9e2af",
  color04: "#89b4fa",
  color05: "#cba6f7",
  color06: "#94e2d5",
  color07: "#cdd6f4",
  color08: "#45475a",
  color09: "#f38ba8",
  color10: "#a6e3a1",
  color11: "#f9e2af",
  color12: "#89b4fa",
  color13: "#cba6f7",
  color14: "#94e2d5",
  color15: "#bac2de",
};

cel.init(new ProcessTerminal(), { theme: mocha });
```

App code uses `"color00"`–`"color15"` regardless of theme. The mapping is a rendering concern.
