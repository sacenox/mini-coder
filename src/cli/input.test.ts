import { describe, expect, test } from "bun:test";
import {
  buildPromptDisplay,
  expandInputBuffer,
  getTurnControlAction,
  pasteLabel,
  pruneInputPasteTokens,
  renderInputBuffer,
} from "./input.ts";

describe("pasteLabel", () => {
  test("single short line", () => {
    expect(pasteLabel("hello world")).toBe('[pasted: "hello world"]');
  });

  test("single line truncated at 40 chars", () => {
    const long = "a".repeat(50);
    const label = pasteLabel(long);
    expect(label).toBe(`[pasted: "${"a".repeat(40)}…"]`);
  });

  test("multi-line shows extra count", () => {
    expect(pasteLabel("line one\nline two\nline three")).toBe(
      '[pasted: "line one" +2 more lines]',
    );
  });

  test("two lines says singular", () => {
    expect(pasteLabel("first\nsecond")).toBe('[pasted: "first" +1 more line]');
  });

  test("empty string", () => {
    expect(pasteLabel("")).toBe('[pasted: ""]');
  });
});

const PASTE_A = String.fromCharCode(0xe000);
const PASTE_B = String.fromCharCode(0xe001);

describe("renderInputBuffer", () => {
  test("renders each paste token with its own label", () => {
    const pasteTokens = new Map<string, string>([
      [PASTE_A, "alpha"],
      [PASTE_B, "beta\ngamma"],
    ]);

    expect(renderInputBuffer(`x${PASTE_A}y${PASTE_B}z`, pasteTokens)).toBe(
      'x[pasted: "alpha"]y[pasted: "beta" +1 more line]z',
    );
  });
});

describe("expandInputBuffer", () => {
  test("expands multiple paste tokens back to their original text", () => {
    const pasteTokens = new Map<string, string>([
      [PASTE_A, "alpha"],
      [PASTE_B, "beta\ngamma"],
    ]);

    expect(expandInputBuffer(`x${PASTE_A}y${PASTE_B}z`, pasteTokens)).toBe(
      "xalphaybeta\ngammaz",
    );
  });
});

describe("pruneInputPasteTokens", () => {
  test("removes a paste token after it has been deleted from all buffers", () => {
    const pasteTokens = new Map<string, string>([
      [PASTE_A, "alpha"],
      [PASTE_B, "beta"],
    ]);

    expect(
      Array.from(pruneInputPasteTokens(pasteTokens, `x${PASTE_B}y`).entries()),
    ).toEqual([[PASTE_B, "beta"]]);
  });

  test("keeps a paste token while it is still referenced by saved input", () => {
    const pasteTokens = new Map<string, string>([
      [PASTE_A, "alpha"],
      [PASTE_B, "beta"],
    ]);

    expect(
      Array.from(
        pruneInputPasteTokens(
          pasteTokens,
          `x${PASTE_B}y`,
          `${PASTE_A}z`,
        ).entries(),
      ),
    ).toEqual([
      [PASTE_A, "alpha"],
      [PASTE_B, "beta"],
    ]);
  });
});

describe("buildPromptDisplay", () => {
  test("keeps the cursor aligned with the visible tail of a long line", () => {
    expect(buildPromptDisplay("abcdefghijklmnopqrstuvwxyz", 26, 10)).toEqual({
      display: "…rstuvwxyz",
      cursor: 10,
    });
  });

  test("shows ellipses on both sides when the cursor is in the middle", () => {
    expect(buildPromptDisplay("abcdefghijklmnopqrstuvwxyz", 15, 10)).toEqual({
      display: "…ghijklmn…",
      cursor: 10,
    });
  });
});

describe("getTurnControlAction", () => {
  test("treats ESC as cancel", () => {
    expect(getTurnControlAction(new Uint8Array([0x1b]))).toBe("cancel");
  });

  test("treats Ctrl+C as quit", () => {
    expect(getTurnControlAction(new Uint8Array([0x03]))).toBe("quit");
  });

  test("only cancels on a lone ESC — escape sequences are ignored and Ctrl+C still wins", () => {
    // [ESC, Ctrl+C]: not a lone ESC, Ctrl+C still fires quit
    expect(getTurnControlAction(new Uint8Array([0x1b, 0x03]))).toBe("quit");
    // [Ctrl+C, ESC]: Ctrl+C fires quit
    expect(getTurnControlAction(new Uint8Array([0x03, 0x1b]))).toBe("quit");
    // Arrow-up sequence ESC [ A: not cancel
    expect(getTurnControlAction(new Uint8Array([0x1b, 0x5b, 0x41]))).toBeNull();
    // Arrow-down sequence ESC [ B: not cancel
    expect(getTurnControlAction(new Uint8Array([0x1b, 0x5b, 0x42]))).toBeNull();
    // Two-byte escape sequence such as Alt+f: not cancel
    expect(getTurnControlAction(new Uint8Array([0x1b, 0x66]))).toBeNull();
  });

  test("returns null for empty or unrelated bytes", () => {
    expect(getTurnControlAction(new Uint8Array([]))).toBeNull();
    expect(getTurnControlAction(new Uint8Array([0x61, 0x62, 0x63]))).toBeNull();
  });
});
