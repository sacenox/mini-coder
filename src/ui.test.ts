import { describe, expect, test } from "bun:test";
import { fauxAssistantMessage } from "@mariozechner/pi-ai";
import { DEFAULT_THEME } from "./theme.ts";
import {
  type PendingToolCall,
  renderAssistantMessage,
  renderStreamingResponse,
} from "./ui.ts";

const RENDER_OPTS = {
  showReasoning: false,
  verbose: false,
  theme: DEFAULT_THEME,
};

describe("ui rendering", () => {
  test("renderAssistantMessage keeps streamed markdown inside one top-level container", () => {
    const message = fauxAssistantMessage("First paragraph\n\nSecond paragraph");

    const node = renderAssistantMessage(message, RENDER_OPTS);

    expect(node).not.toBeNull();
    expect(node?.type).toBe("vstack");
    if (!node || node.type !== "vstack") {
      throw new Error("Expected a vstack container");
    }
    expect(node.children.length).toBeGreaterThan(1);
  });

  test("renderStreamingResponse keeps text and tool output inside one top-level container", () => {
    const pendingToolCalls: PendingToolCall[] = [
      {
        name: "shell",
        args: { command: "echo hi" },
        resultText: "hi",
        isError: false,
      },
    ];

    const node = renderStreamingResponse(
      {
        text: "Working...",
        thinking: "",
        pendingToolCalls,
      },
      RENDER_OPTS,
    );

    expect(node).not.toBeNull();
    expect(node?.type).toBe("vstack");
    if (!node || node.type !== "vstack") {
      throw new Error("Expected a vstack container");
    }
    expect(node.children.length).toBeGreaterThanOrEqual(2);
  });
});
