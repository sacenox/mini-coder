import { describe, expect, test } from "bun:test";
import { stripAnsi } from "../cli/test-helpers.ts";
import {
  buildResumeSessionCommand,
  buildResumeSessionHint,
  buildSessionExitMessage,
} from "./resume-command.ts";

describe("resume command copy", () => {
  test("builds a short resume command", () => {
    expect(buildResumeSessionCommand("sess_123")).toBe("mc -r sess_123");
  });

  test("builds a reusable session hint", () => {
    expect(
      stripAnsi(buildResumeSessionHint("<id>", "to continue a session.")),
    ).toBe("Use mc -r <id> to continue a session.");
  });

  test("builds the interactive exit message", () => {
    expect(stripAnsi(buildSessionExitMessage("sess_123"))).toBe(
      "Use mc -r sess_123 to continue this session.\nGoodbye.",
    );
  });
});
