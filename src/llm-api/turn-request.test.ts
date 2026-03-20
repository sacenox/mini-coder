import { describe, expect, test } from "bun:test";
import type { CoreMessage } from "./turn.ts";
import { applyContextPruning } from "./turn-context.ts";
import { buildStreamTextRequest } from "./turn-request.ts";

function makePrepared(messages: CoreMessage[]) {
  return {
    messages,
    systemPrompt: undefined,
    pruned: false,
    prePruneMessageCount: messages.length,
    postPruneMessageCount: messages.length,
    prePruneTotalBytes: 0,
    postPruneTotalBytes: 0,
  };
}

function makeDefaultInput(
  messages: CoreMessage[],
  modelString = "openai/gpt-5.4",
) {
  return {
    model: {} as Parameters<typeof buildStreamTextRequest>[0]["model"],
    modelString,
    prepared: makePrepared(messages),
    toolSet: {},
    onStepFinish: () => {},
    signal: undefined,
    providerOptions: {},
    stepPruneQueue: [],
  };
}

/** Build a long history with tool-call + tool-result pairs. */
function buildToolHistory(pairCount: number): CoreMessage[] {
  const messages: CoreMessage[] = [];
  for (let i = 0; i < pairCount; i++) {
    messages.push({ role: "user", content: `u${i}` });
    messages.push({
      role: "assistant",
      content: [
        {
          type: "tool-call",
          toolCallId: `tc${i}`,
          toolName: "shell",
          input: {},
        },
      ],
    } as unknown as CoreMessage);
    messages.push({
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: `tc${i}`,
          toolName: "shell",
          output: { text: `result-${i}` },
        },
      ],
    } as unknown as CoreMessage);
  }
  messages.push({ role: "user", content: "final" });
  return messages;
}

interface PrepareStepResult {
  messages?: CoreMessage[];
}

/** Call prepareStep on a request, failing if it's missing. */
function callPrepareStep(
  request: ReturnType<typeof buildStreamTextRequest>,
  stepNumber: number,
  messages: CoreMessage[],
): PrepareStepResult {
  const fn = request.prepareStep;
  if (!fn) throw new Error("prepareStep missing from request");
  return fn({
    stepNumber,
    messages,
    model: {} as never,
    steps: [],
    experimental_context: undefined,
  }) as PrepareStepResult;
}

describe("buildStreamTextRequest", () => {
  test("overrides the AI SDK default onError logger", () => {
    const request = buildStreamTextRequest(
      makeDefaultInput([{ role: "user", content: "hi" }] as CoreMessage[]),
    );

    expect(request.onError?.({ error: new Error("boom") })).toBeUndefined();
  });

  test("prepareStep is present on the returned request", () => {
    const request = buildStreamTextRequest(
      makeDefaultInput([{ role: "user", content: "hi" }] as CoreMessage[]),
    );
    expect(request.prepareStep).toBeFunction();
  });

  test("prepareStep skips pruning at step 0 (already pruned by prepareTurnMessages)", () => {
    const messages = buildToolHistory(30);
    const request = buildStreamTextRequest(makeDefaultInput(messages));

    const result = callPrepareStep(request, 0, messages);

    // For non-Anthropic models, step 0 returns empty (no modifications)
    expect(result).toEqual({});
  });

  test("prepareStep preserves initial prefix at step 1+ (cache-friendly)", () => {
    // Simulate the real flow: prepareTurnMessages prunes first, then
    // prepareStep runs on the pruned messages + new step responses.
    const raw = buildToolHistory(30); // 91 messages
    const prePruned = applyContextPruning(raw); // simulates prepareTurnMessages
    const request = buildStreamTextRequest(makeDefaultInput(prePruned));

    // Simulate step 1: pre-pruned messages + new tool interaction
    const withNewMessages = [
      ...prePruned,
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "new1",
            toolName: "shell",
            input: {},
          },
        ],
      } as unknown as CoreMessage,
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "new1",
            toolName: "shell",
            output: { text: "new-result" },
          },
        ],
      } as unknown as CoreMessage,
    ];

    const result = callPrepareStep(request, 1, withNewMessages);

    // Adjusted window covers everything — no messages removed
    expect(result.messages).toBeDefined();
    expect(result.messages?.length).toBe(withNewMessages.length);

    // Initial prefix is byte-identical (cache-friendly)
    for (let i = 0; i < prePruned.length; i++) {
      expect(JSON.stringify(result.messages?.[i])).toBe(
        JSON.stringify(prePruned[i]),
      );
    }
  });

  test("prepareStep adds cache breakpoints for Anthropic models", () => {
    const messages: CoreMessage[] = [
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi" } as CoreMessage,
    ];
    const request = buildStreamTextRequest(
      makeDefaultInput(messages, "anthropic/claude-sonnet-4-5"),
    );

    const result = callPrepareStep(request, 0, messages);

    // Should return messages with cache breakpoint annotations
    expect(result.messages).toBeDefined();
    const annotated = result.messages ?? [];
    const withCache = annotated.filter(
      (m: CoreMessage) =>
        m.providerOptions?.anthropic &&
        (m.providerOptions.anthropic as Record<string, unknown>).cacheControl,
    );
    expect(withCache.length).toBeGreaterThan(0);
  });

  test("prepareStep falls back to full pruning on very long turns", () => {
    // Build a history that exceeds the step prune fallback threshold (200)
    const huge = buildToolHistory(70); // 70*3 + 1 = 211 messages
    const request = buildStreamTextRequest(makeDefaultInput(huge));

    const result = callPrepareStep(request, 1, huge);

    // Full context pruning kicks in — old tool calls removed
    expect(result.messages).toBeDefined();
    expect(result.messages?.length).toBeLessThan(huge.length);
  });

  test("prepareStep preserves messages across growing steps", () => {
    // Pre-prune to simulate real prepareTurnMessages flow
    const raw = buildToolHistory(20); // 61 messages
    const base = applyContextPruning(raw);
    const request = buildStreamTextRequest(makeDefaultInput(base));

    // Step 1: same as initial
    const result1 = callPrepareStep(request, 1, base);

    // Step 5: 10 new messages appended
    const grown = [...base];
    for (let i = 0; i < 5; i++) {
      grown.push({
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: `extra${i}`,
            toolName: "shell",
            input: {},
          },
        ],
      } as unknown as CoreMessage);
      grown.push({
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: `extra${i}`,
            toolName: "shell",
            output: { text: `extra-${i}` },
          },
        ],
      } as unknown as CoreMessage);
    }
    const result5 = callPrepareStep(request, 5, grown);

    // Adjusted window preserves everything
    expect(result1.messages?.length).toBe(base.length);
    expect(result5.messages?.length).toBe(grown.length);
  });
});
