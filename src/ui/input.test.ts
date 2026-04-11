import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_THEME } from "../theme.ts";
import {
  autocompleteInputPath,
  type InputController,
  renderInputArea,
} from "./input.ts";

const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "mini-coder-ui-input-test-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function expectTextInput(node: ReturnType<typeof renderInputArea>) {
  if (node.type !== "textinput") {
    throw new Error("Expected a TextInput node");
  }
  return node;
}

describe("ui/input", () => {
  test("renderInputArea shows the current draft with the configured placeholder and size limits", () => {
    const controller: InputController = {
      onChange: () => {},
      onFocus: () => {},
      onBlur: () => {},
      onKeyPress: () => undefined,
    };

    const input = expectTextInput(
      renderInputArea(DEFAULT_THEME, controller, "draft", true),
    );
    const placeholder = input.props.placeholder;

    expect(input.props.value).toBe("draft");
    expect(input.props.focused).toBe(true);
    expect(input.props.minHeight).toBe(2);
    expect(input.props.maxHeight).toBe(10);
    expect(input.props.padding).toEqual({ x: 1 });
    expect(placeholder?.type).toBe("text");
    if (!placeholder || placeholder.type !== "text") {
      throw new Error("Expected a text placeholder");
    }
    expect(placeholder.content).toBe(
      "`Ctrl+R` for input history, `/` + `Tab` for interactive menu, or type a message…",
    );
    expect(placeholder.props.fgColor).toBe(DEFAULT_THEME.mutedText);
    expect(placeholder.props.italic).toBe(true);
  });

  test("autocompleteInputPath completes the last file path token", () => {
    const cwd = createTempDir();
    mkdirSync(join(cwd, "src"), { recursive: true });
    writeFileSync(join(cwd, "src", "ui.ts"), "", "utf-8");

    expect(autocompleteInputPath("inspect src/u", cwd)).toBe(
      "inspect src/ui.ts",
    );
  });

  test("autocompleteInputPath returns null when no completion is available", () => {
    const cwd = createTempDir();

    expect(autocompleteInputPath("inspect src/u", cwd)).toBeNull();
  });
});
