# Composing Components

cel-tui components are plain functions that return `Node` trees. There are two patterns depending on whether the component needs internal state.

## Stateless components

Simple functions that take props and return a `Node`. Called every render cycle inside `cel.viewport()`. All state is external — passed in as props.

```ts
import type { ContainerNode } from "@cel-tui/types";
import { HStack, VStack, Text } from "@cel-tui/core";

function StatusBar(left: string, right: string): ContainerNode {
  return HStack({ fgColor: "color00", bgColor: "color07" }, [
    Text(` ${left}`),
    VStack({ flex: 1 }, []), // spacer
    Text(`${right} `),
  ]);
}

// Usage — called fresh each render
cel.viewport(() =>
  VStack({ height: "100%" }, [
    mainContent(),
    StatusBar(filename, `${lines} lines`),
  ]),
);
```

This is the pattern used by `Button`, `Divider`, `Spacer`, `VDivider`, `Markdown`, and `SyntaxHighlight` — stateless functions that derive output from current inputs. Prefer it whenever possible — it's simple, testable, and composable.

## Stateful components (factory pattern)

When a component needs internal state that persists across renders (e.g., a search query, cursor position, scroll offset), use a **factory function** that returns a callable instance. State lives in the closure. The user calls the instance each render to get a fresh `Node` tree.

```ts
import type { ContainerNode, Color } from "@cel-tui/types";
import { cel, VStack, HStack, Text } from "@cel-tui/core";

interface ToggleGroupProps {
  options: string[];
  onSelect: (value: string) => void;
  activeColor?: Color;
}

interface ToggleGroupInstance {
  (): ContainerNode;
  reset(): void;
}

function ToggleGroup(props: ToggleGroupProps): ToggleGroupInstance {
  const { options, onSelect, activeColor = "color06" } = props;
  let activeIndex = 0;

  function handleKey(key: string): boolean | void {
    if (key === "left" && activeIndex > 0) {
      activeIndex--;
      cel.render();
    } else if (key === "right" && activeIndex < options.length - 1) {
      activeIndex++;
      cel.render();
    } else if (key === "enter") {
      onSelect(options[activeIndex]!);
    } else {
      return false; // unrecognized key — let it bubble to ancestors
    }
  }

  function render(): ContainerNode {
    return HStack(
      { focusable: true, onKeyPress: handleKey, gap: 1 },
      options.map((opt, i) =>
        Text(` ${opt} `, {
          fgColor: i === activeIndex ? "color00" : undefined,
          bgColor: i === activeIndex ? activeColor : undefined,
        }),
      ),
    );
  }

  render.reset = () => {
    activeIndex = 0;
  };
  return render as ToggleGroupInstance;
}

// Usage — create once, call each render
const formatToggle = ToggleGroup({
  options: ["JSON", "YAML", "TOML"],
  onSelect: (fmt) => {
    format = fmt;
    cel.render();
  },
});

cel.viewport(() =>
  VStack({ height: "100%" }, [Text("Output format:"), formatToggle()]),
);
```

## Key points

- **Create once** outside `cel.viewport()`. The closure captures mutable state.
- **Call each render** inside `cel.viewport()` — the function builds a fresh node tree from current state.
- **`cel.render()`** is importable from `@cel-tui/core` — stateful components call it after internal state changes to trigger re-renders.
- **Key bubbling** — `onKeyPress` handlers bubble from innermost to root. Return `false` from a handler to signal the key was not consumed and let it continue to the next ancestor. Return `void`/`undefined` to consume (backward-compatible). Components like `Select` return `false` for unrecognized keys, so app-level shortcuts on parent containers work automatically.
- **`.reset()`** or other methods — attach to the render function (functions are objects in JS) to expose imperative control.

This is the pattern used by `Select` from `@cel-tui/components`.
