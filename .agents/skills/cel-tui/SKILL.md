---
name: cel-tui
description: Build terminal user interfaces with cel-tui, a TypeScript TUI framework. Use when the user wants to create a TUI app, build a terminal UI, render text in the terminal, create a CLI with interactive elements, build a chat interface, text editor, or any interactive terminal application. Triggers include "build a TUI", "terminal UI", "interactive CLI", "text-based interface", "render to terminal", or any task requiring a programmatic terminal user interface.
license: MIT
compatibility: Requires Bun runtime. Best experience on Kitty-compatible terminals and in tmux with `set -s extended-keys on`; uses SGR mouse mode and accepts recoverable legacy key encodings when hosts do not preserve a pure Kitty stream.
metadata:
  author: sacenox
  version: "0.8.1"
---

# Building TUIs with cel-tui

cel-tui is a TypeScript TUI framework with a declarative functional API, flexbox layout, cell-buffer rendering, style inheritance, and Kitty-first keyboard input. It has 4 primitives and external state management.

## Terminal compatibility

- **First-class:** Kitty-compatible terminals
- **First-class:** `tmux` with `set -s extended-keys on`
- **Best effort:** legacy terminals or multiplexers that collapse some modifier distinctions

cel-tui enables Kitty level 1 for full modifier fidelity, but it also accepts recoverable legacy control bytes and ESC-prefixed Alt combinations so common keyboard flows keep working in tmux and mixed environments.

## Install

```bash
bun add @cel-tui/core
# Optional pre-made components
bun add @cel-tui/components
# Optional stream-first syntax tokenization
bun add @cel-tui/clew
```

## Core Pattern

Every cel-tui app follows this structure:

```ts
import {
  cel,
  VStack,
  HStack,
  Text,
  TextInput,
  ProcessTerminal,
} from "@cel-tui/core";

let value = "";

cel.init(new ProcessTerminal());
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
    [
      Text("My App", { bold: true, fgColor: "color06" }),
      Text("─", { repeat: "fill" }),
      TextInput({
        flex: 1,
        value,
        onChange: (v) => {
          value = v;
          cel.render();
        },
      }),
    ],
  ),
);
```

The steps: `cel.init(terminal)` → `cel.viewport(() => tree)` → mutate state + `cel.render()`.

Use `cel.setTitle("My App")` when you want to update the terminal window or tab title. It is imperative terminal state, not part of the render tree, and the previous title is not restored automatically on `cel.stop()`.

## 4 Primitives

| Primitive                 | Type                    | Description                               |
| ------------------------- | ----------------------- | ----------------------------------------- |
| `VStack(props, children)` | Container               | Vertical stack — children top to bottom   |
| `HStack(props, children)` | Container               | Horizontal stack — children left to right |
| `Text(content, props?)`   | Leaf                    | Styled text, no children                  |
| `TextInput(props)`        | Container (no children) | Multi-line editable text                  |

Containers accept sizing (`width`, `height`, `flex`, `"50%"`, `minWidth`/`maxWidth`), layout (`padding`, `gap`, `justifyContent`, `alignItems`, `flexWrap`), scroll (`overflow: "scroll"`, `scrollbar`, `scrollStep`, `scrollOffset`, `onScroll`), styling (`fgColor`, `bgColor`, `bold`, `focusStyle`), and interaction (`onClick`, `focusable`, `focused`, `onKeyPress`). Colors are numbered palette slots (`"color00"`–`"color15"`), mapped to ANSI 16 by default. Custom themes can remap slots to different ANSI indices or 24-bit true color via `cel.init(terminal, { theme })`.

Read [references/api.md](references/api.md) for the full props listing, sizing strategies, text props, and component reference.

## Common Patterns

### Spacer, divider, button

```ts
HStack({ height: 1 }, [Text("left"), VStack({ flex: 1 }, []), Text("right")]);
Text("─", { repeat: "fill", fgColor: "color08" });
HStack(
  {
    onClick: handleClick,
    focusStyle: { bgColor: "color06", fgColor: "color00" },
  },
  [Text(" Send ", { bold: true })],
);
```

### Scrollable list

Scroll is **uncontrolled by default** — the framework manages scroll position internally. Mouse wheel just works:

```ts
VStack({ overflow: "scroll", scrollbar: true }, [...items]);
```

Mouse wheel scrolling uses an **adaptive step** by default based on the scroll target's visible main-axis viewport size:

- `floor(viewportMainAxis / 3)`
- clamped to `3..8`

Override it with `scrollStep` when a view should scroll faster or slower:

```ts
VStack({ overflow: "scroll", scrollbar: true, scrollStep: 6 }, [...items]);
```

Provide `scrollOffset` + `onScroll` to opt into **controlled mode** — you own the state:

```ts
let offset = 0;

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

Controlled mode enables patterns like auto-scroll to bottom on new content. `scrollStep` affects mouse wheel input only — not programmatic `scrollOffset` updates.

### Measuring content height

Use `measureContentHeight(node, { width })` when your app knows the wrapping width but needs to know how tall a content subtree will be.

```ts
import { measureContentHeight, VStack } from "@cel-tui/core";

const addedHeight = measureContentHeight(
  VStack({}, olderMessages.map(renderMessage)),
  { width: historyContentWidth },
);

scrollOffset += addedHeight;
```

This is for **intrinsic content measurement**, not viewport/clipping measurement. The provided `width` is authoritative. Measure the content subtree you are adding or anchoring around — not a wrapper whose visible height is controlled by `height`, `flex`, or percentage sizing. If you measure a padded container, pass its outer width; if you measure the children inside a padded container directly, pass the inner content width.

### Layers (modals)

Return an array from the render function — layers composite bottom-to-top:

```ts
cel.viewport(() => [
  VStack({ height: "100%" }, [...mainUI]),
  ...(showModal
    ? [
        VStack(
          { height: "100%", justifyContent: "center", alignItems: "center" },
          [
            VStack(
              { width: 40, height: 10, bgColor: "color08", fgColor: "color07" },
              [...modalContent],
            ),
          ],
        ),
      ]
    : []),
]);
```

### Focus

Focus is **uncontrolled by default** — Tab/Shift+Tab/Escape/click just work. Provide `focused` prop to opt into controlled mode:

```ts
// Uncontrolled — framework manages focus
HStack({ onClick: handleAction }, [Text("[ OK ]")]);

// Controlled — app owns focus state
TextInput({
  value,
  onChange,
  focused: isFocused,
  onFocus: ({ reason }) => {
    addLog(`focused via ${reason}`);
    isFocused = true;
    cel.render();
  },
});
```

### Style inheritance

Containers propagate styles to descendants. Explicit props always win:

```ts
VStack({ fgColor: "color07", bgColor: "color04" }, [
  Text("inherits color07 on color04"),
  Text("explicit color02", { fgColor: "color02" }),
]);
```

### Select component

```ts
import { Select } from "@cel-tui/components";

const mySelect = Select({
  items: ["apple", "banana", "cherry"],
  onSelect: (value) => {
    chosen = value;
    cel.render();
  },
});

// ctrl+q lives on the root — Select returns false for unrecognized
// keys, so they bubble up automatically.
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
    [mySelect()],
  ),
);
mySelect.reset(); // clear filter/highlight programmatically
```

### SyntaxHighlight component

```ts
import { SyntaxHighlight } from "@cel-tui/components";

VStack({ flex: 1, overflow: "scroll", padding: { x: 1 } }, [
  SyntaxHighlight(source, "typescript"),
]);

SyntaxHighlight(source, "javascript", { theme: "dark-plus" });
```

`SyntaxHighlight(content, language, props?)` renders registered `clew` languages into cel-tui primitives. Current ids include the TypeScript / JavaScript families plus `python` / `py`, `bash`, `json`, and `markdown`. The component stays synchronous to call, but append-only updates reuse a cached `clew` stream while non-append edits replay the full snippet, so final output stays stable across streamed chunk boundaries. Unknown language ids render plain text. The optional `theme` accepts the small built-in presets (`"default"`, `"dark-plus"`) or a best-effort token-color registration object targeting canonical `clew` scopes.

## Gotchas

- **State is external** — the framework has no state. Mutate variables then call `cel.render()`.
- **Text is a pure leaf** — no sizing props, no children. Parent controls the box.
- **TextInput consumes insertable text and editing/navigation keys** when focused (printable text, arrows, backspace, Enter, Tab), plus readline-style shortcuts: `ctrl+a` / `ctrl+e`, `alt+b` / `alt+f`, `ctrl+left` / `ctrl+right`, `ctrl+w`, and `alt+d`. Word movement and deletion are whitespace-delimited, and `up` / `down` follow visual wrapped lines. Enter inserts a newline by default. Use `onKeyPress` on TextInput to intercept keys before editing — return `false` to prevent the default action (e.g., intercept Enter for submit). `onKeyPress` receives normalized semantic key strings, while inserted text preserves the original characters (uppercase `A` arrives as key `"a"` but inserts `"A"`). Other modifier combos (`ctrl+s`) and non-insertable control keys bubble up through ancestors via `onKeyPress`.
- **Escape unfocuses** the current element. Tab/Shift+Tab traverses focusable elements (wraps around). After Escape, traversal continues from where focus was lost.
- **Enter activates** a focused container's `onClick`. If no `onClick`, Enter reaches `onKeyPress`.
- **`focusable: true`** without `onClick` makes a container keyboard-focusable (receives `onKeyPress` events via Tab). Used by stateful components like `Select`.
- **Innermost handler wins** — for `onClick` and `onScroll`. For `onKeyPress`, keys **bubble up** through ancestors: return `false` from a handler to let the key continue to the next ancestor. Returning `void`/`undefined` consumes the key (stops bubbling). This is backward-compatible.
- **Mouse wheel step is adaptive by default** — scrollable containers and `TextInput` use `floor(viewportMainAxis / 3)`, clamped to `3..8`. Set `scrollStep` to override it for a specific view.
- **Container `bgColor`** fills the rect with opaque background before painting children. Always pair `bgColor` with `fgColor` for contrast — terminal default fg is designed for the terminal default bg, not for arbitrary palette backgrounds.
- **Colors are numbered slots** (`"color00"`–`"color15"`), not names. The default theme maps to ANSI 16. Omit `fgColor`/`bgColor` for terminal defaults (guaranteed readable across themes).
- **Crash cleanup** — terminal state is restored on SIGINT, SIGTERM, uncaughtException.
- **Always call `cel.stop()` before `process.exit()`** — restores raw mode, mouse tracking, and alternate screen.
- **Kitty-first keyboard input** — the framework enables Kitty level 1 and gets full modifier fidelity when the host preserves it (`alt+x`, `ctrl+plus`, `shift+enter`, etc.). It also normalizes recoverable legacy encodings so common shortcuts keep working in tmux. For best results, use a Kitty-compatible terminal or `tmux` with `set -s extended-keys on`. On older legacy hosts, historically ambiguous collisions such as `ctrl+i` vs `tab` or `ctrl+m` vs `enter` cannot be recovered once the host collapses them.
- **tmux is good for keyboard-driven manual checks** — common `tmux send-keys` paths work for printable chars, `Tab`/`BTab`, `Enter`, `Escape`, arrows, and many `Ctrl+letter` shortcuts. Use exact raw-sequence injection only when you need to target a protocol-specific encoding. Mouse input remains unreliable in tmux and should be verified in a real terminal.
- **Button limitations** — `Button` from `@cel-tui/components` does not forward container sizing props (`width`, `height`, `flex`, `minWidth`, etc.). It supports styling (`fgColor`, `bgColor`, `bold`, etc.), `focusStyle`, `focused`, `onFocus`, `onBlur`, `onKeyPress`, and `padding`. For full layout control, use `HStack` + `Text` directly.
- **SyntaxHighlight only keeps parser state for append-only growth** — appended content reuses a cached `clew` stream, but non-append edits still reset and replay the full snippet so final output stays deterministic across chunk boundaries. Unknown language ids render plain text.

## Composing Components

Stateless components are plain functions returning `Node` trees — prefer this pattern. When a component needs internal state across renders, use a factory function that returns a callable instance. Read [references/composing-components.md](references/composing-components.md) for full patterns and examples.

For the full framework specification, see the [cel-tui spec](https://raw.githubusercontent.com/sacenox/cel-tui/main/spec.md).
