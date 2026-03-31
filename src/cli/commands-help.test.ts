import { afterEach, describe, expect, test } from "bun:test";
import { renderHelpCommand } from "./commands-help.ts";
import {
  captureStdout,
  getCapturedStdout,
  restoreStdout,
  stripAnsi,
} from "./test-helpers.ts";

afterEach(() => {
  restoreStdout();
});

describe("renderHelpCommand", () => {
  test("lists the /models alias", () => {
    captureStdout();

    renderHelpCommand({ cwd: process.cwd() } as never);

    expect(stripAnsi(getCapturedStdout())).toContain("/models");
  });
});
