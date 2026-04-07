import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_THEME } from "./theme.ts";
import {
  autocompleteInputPath,
  type InputController,
  renderInputArea,
} from "./ui/input.ts";

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

describe("ui/input", () => {
  test("renderInputArea returns a direct TextInput with the provided state and handlers", () => {
    const controller: InputController = {
      onChange: () => {},
      onFocus: () => {},
      onBlur: () => {},
      onKeyPress: () => undefined,
    };

    const input = renderInputArea(DEFAULT_THEME, controller, "draft", true);

    expect(input.type).toBe("textinput");
    if (input.type !== "textinput") {
      throw new Error("Expected a TextInput node");
    }

    expect(input.props.value).toBe("draft");
    expect(input.props.focused).toBe(true);
    expect(input.props.placeholder?.props.fgColor).toBe(
      DEFAULT_THEME.mutedText,
    );
    expect(input.props.padding).toEqual({ x: 1 });
    expect(input.props.minHeight).toBe(2);
    expect(input.props.maxHeight).toBe(10);
    expect(input.props.onChange).toBe(controller.onChange);
    expect(input.props.onFocus).toBe(controller.onFocus);
    expect(input.props.onBlur).toBe(controller.onBlur);
    expect(input.props.onKeyPress).toBe(controller.onKeyPress);
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
