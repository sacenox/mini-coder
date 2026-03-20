import { describe, expect, test } from "bun:test";
import {
  deleteWordBackward,
  insertAtCursor,
  moveCursorWordLeft,
  moveCursorWordRight,
} from "./input-editing.ts";

describe("input-editing", () => {
  test("insertAtCursor inserts text and advances cursor", () => {
    const next = insertAtCursor("hello world", 5, ",");
    expect(next).toEqual({
      buf: "hello, world",
      cursor: 6,
    });
  });

  test("moveCursorWordLeft skips trailing spaces and previous word", () => {
    expect(moveCursorWordLeft("hello brave new world", 15)).toBe(12);
    expect(moveCursorWordLeft("hello  world", 7)).toBe(0);
  });

  test("moveCursorWordRight skips spaces then moves across next word", () => {
    expect(moveCursorWordRight("hello brave new world", 5)).toBe(11);
    expect(moveCursorWordRight("hello  world", 5)).toBe(12);
  });

  test("deleteWordBackward removes the previous word", () => {
    const next = deleteWordBackward("hello brave world", 12);
    expect(next).toEqual({
      buf: "hello world",
      cursor: 6,
    });
  });
});
