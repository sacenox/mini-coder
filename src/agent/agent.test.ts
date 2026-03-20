import { describe, expect, test } from "bun:test";
import type { CoreMessage } from "../llm-api/turn.ts";
import {
  extractAssistantText,
  makeInterruptMessage,
  sanitizeModelAuthoredMessages,
} from "./agent-helpers.ts";

// ─── extractAssistantText ─────────────────────────────────────────────────────

describe("extractAssistantText", () => {
  test("returns empty string for empty message list", () => {
    expect(extractAssistantText([])).toBe("");
  });

  test("returns empty string when no assistant messages present", () => {
    const msgs: CoreMessage[] = [{ role: "user", content: "hello" }];
    expect(extractAssistantText(msgs)).toBe("");
  });

  test("extracts string content from an assistant message", () => {
    const msgs: CoreMessage[] = [{ role: "assistant", content: "All done." }];
    expect(extractAssistantText(msgs)).toBe("All done.");
  });

  test("extracts text parts from array content", () => {
    const msgs: CoreMessage[] = [
      {
        role: "assistant",
        content: [
          { type: "text", text: "I will run the tests." },
          { type: "tool-call", toolCallId: "1", toolName: "shell", input: {} },
        ],
      },
    ];
    expect(extractAssistantText(msgs)).toBe("I will run the tests.");
  });

  test("concatenates text across multiple assistant messages", () => {
    const msgs: CoreMessage[] = [
      { role: "user", content: "go" },
      { role: "assistant", content: "Fixing the bug." },
      { role: "assistant", content: "All done." },
    ];
    expect(extractAssistantText(msgs)).toBe("Fixing the bug.\nAll done.");
  });

  test("returns empty string when assistant message has no text parts", () => {
    const msgs: CoreMessage[] = [
      {
        role: "assistant",
        content: [
          { type: "tool-call", toolCallId: "1", toolName: "shell", input: {} },
        ],
      },
    ];
    expect(extractAssistantText(msgs)).toBe("");
  });

  test("extracts text from array content when last part is a tool call", () => {
    const msgs: CoreMessage[] = [
      {
        role: "assistant",
        content: [
          { type: "text", text: "Tests pass." },
          { type: "tool-call", toolCallId: "1", toolName: "shell", input: {} },
        ],
      },
    ];
    expect(extractAssistantText(msgs)).toBe("Tests pass.");
  });
});

describe("sanitizeModelAuthoredMessages", () => {
  test("strips GPT commentary parts before messages are reused or persisted", () => {
    const msgs: CoreMessage[] = [
      {
        role: "assistant",
        content: [
          { type: "reasoning", text: "plan" },
          {
            type: "text",
            text: "hidden commentary",
            providerOptions: { openai: { phase: "commentary" } },
          },
          {
            type: "text",
            text: "final answer",
            providerOptions: { openai: { phase: "final_answer" } },
          },
        ],
      } as unknown as CoreMessage,
    ];

    expect(sanitizeModelAuthoredMessages(msgs, "openai/gpt-5.3-codex")).toEqual(
      [
        {
          role: "assistant",
          content: [
            { type: "reasoning", text: "plan" },
            {
              type: "text",
              text: "final answer",
              providerOptions: { openai: { phase: "final_answer" } },
            },
          ],
        },
      ],
    );
  });

  test("strips runtime-only tool fields from persisted tool calls", () => {
    const msgs: CoreMessage[] = [
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "1",
            toolName: "read",
            input: {
              path: "TODO.md",
              cwd: "/tmp/project",
            },
          },
        ],
      } as unknown as CoreMessage,
    ];

    expect(
      sanitizeModelAuthoredMessages(msgs, "anthropic/claude-sonnet-4-5"),
    ).toEqual([
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "1",
            toolName: "read",
            input: { path: "TODO.md" },
          },
        ],
      },
    ]);
  });
});

// ─── makeInterruptMessage ─────────────────────────────────────────────────────

describe("makeInterruptMessage", () => {
  test("user reason produces an assistant role message", () => {
    const msg = makeInterruptMessage("user");
    expect(msg.role).toBe("assistant");
  });

  test("error reason produces an assistant role message", () => {
    const msg = makeInterruptMessage("error");
    expect(msg.role).toBe("assistant");
  });

  test("user reason content contains system-message tag", () => {
    const msg = makeInterruptMessage("user");
    expect(msg.content).toContain("<system-message>");
    expect(msg.content).toContain("</system-message>");
    expect(msg.content).toContain("interrupted by the user");
  });

  test("error reason content contains system-message tag", () => {
    const msg = makeInterruptMessage("error");
    expect(msg.content).toContain("<system-message>");
    expect(msg.content).toContain("</system-message>");
    expect(msg.content).toContain("interrupted due to an error");
  });

  test("user and error produce different messages", () => {
    expect(makeInterruptMessage("user").content).not.toBe(
      makeInterruptMessage("error").content,
    );
  });
});
