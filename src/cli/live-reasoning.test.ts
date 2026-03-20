import { afterEach, describe, expect, test } from "bun:test";
import { LiveReasoningBlock } from "./live-reasoning.ts";
import {
  captureStdout,
  getCapturedStdout,
  restoreStdout,
  stripAnsi,
} from "./test-helpers.ts";

afterEach(() => {
  restoreStdout();
});

describe("LiveReasoningBlock", () => {
  test("streams partial reasoning immediately instead of waiting for finish", () => {
    captureStdout();
    const block = new LiveReasoningBlock();

    block.append("think");
    expect(stripAnsi(getCapturedStdout())).toBe("· reasoning\n  think");

    block.append("ing");
    expect(stripAnsi(getCapturedStdout())).toBe("· reasoning\n  thinking");

    block.finish();
    expect(stripAnsi(getCapturedStdout())).toBe("· reasoning\n  thinking\n");
  });

  test("preserves blank reasoning lines and italic styling", () => {
    captureStdout();
    const block = new LiveReasoningBlock();

    block.append("line 1\n\nline 3");
    block.finish();

    expect(stripAnsi(getCapturedStdout())).toBe(
      "· reasoning\n  line 1\n  \n  line 3\n",
    );
    expect(getCapturedStdout().includes("\x1b[3m")).toBe(true);
  });
});
