import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applyExactTextEdit,
  FileEditError,
  planExactTextEdit,
} from "./exact-text.ts";

let cwd = "";

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), "mc-file-edit-test-"));
});

afterEach(async () => {
  if (cwd) {
    await rm(cwd, { recursive: true, force: true });
    cwd = "";
  }
});

describe("planExactTextEdit", () => {
  test("replaces one exact unique match", () => {
    const result = planExactTextEdit(
      "alpha\nbeta\ngamma\n",
      "beta\n",
      "BETA\n",
    );

    expect(result).toEqual({
      updated: "alpha\nBETA\ngamma\n",
      changed: true,
    });
  });

  test("throws when the expected text is empty", () => {
    expect(() => planExactTextEdit("abc", "", "x")).toThrow(
      "Expected text must be non-empty.",
    );
  });

  test("throws when the expected text matches multiple locations", () => {
    expect(() => planExactTextEdit("x\ny\nx\n", "x", "z")).toThrow(
      "Expected text matched multiple locations in the file.",
    );
  });
});

describe("applyExactTextEdit", () => {
  test("writes an exact replacement and returns a relative path", async () => {
    await writeFile(join(cwd, "f.txt"), "a\nb\nc\n");

    const result = await applyExactTextEdit({
      cwd,
      path: "f.txt",
      oldText: "b\n",
      newText: "B\n",
    });

    expect(result).toEqual({
      path: "f.txt",
      changed: true,
      before: "a\nb\nc\n",
      after: "a\nB\nc\n",
    });
    expect(await Bun.file(join(cwd, "f.txt")).text()).toBe("a\nB\nc\n");
  });

  test("does not rewrite the file when the replacement is identical", async () => {
    await writeFile(join(cwd, "f.txt"), "same\n");

    const result = await applyExactTextEdit({
      cwd,
      path: "f.txt",
      oldText: "same\n",
      newText: "same\n",
    });

    expect(result).toEqual({
      path: "f.txt",
      changed: false,
      before: "same\n",
      after: "same\n",
    });
    expect(await Bun.file(join(cwd, "f.txt")).text()).toBe("same\n");
  });

  test("throws a typed error when the target is not found", async () => {
    await writeFile(join(cwd, "f.txt"), "a\nb\n");

    try {
      await applyExactTextEdit({
        cwd,
        path: "f.txt",
        oldText: "missing",
        newText: "x",
      });
      expect.unreachable("expected applyExactTextEdit to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(FileEditError);
      expect((error as FileEditError).code).toBe("target_not_found");
    }
  });
});
