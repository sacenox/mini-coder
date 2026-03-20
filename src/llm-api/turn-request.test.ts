import { describe, expect, test } from "bun:test";
import type { CoreMessage } from "./turn.ts";
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

  test("prepareStep prunes tool history at step 1+", () => {
    // 30 tool-call/result pairs = 91 messages (30*3 + 1 final user)
    const messages = buildToolHistory(30);
    const request = buildStreamTextRequest(makeDefaultInput(messages));

    const result = callPrepareStep(request, 1, messages);

    // pruneMessages with "before-last-40-messages" should remove old tool
    // history, resulting in fewer messages than the original 91
    expect(result.messages).toBeDefined();
    expect(result.messages?.length).toBeLessThan(messages.length);
  });

  test("prepareStep does not prune short conversations at step 1+", () => {
    // 5 pairs = 16 messages, well under the 40-message threshold
    const messages = buildToolHistory(5);
    const request = buildStreamTextRequest(makeDefaultInput(messages));

    const result = callPrepareStep(request, 1, messages);

    // Short conversations should keep all messages
    expect(result.messages).toBeDefined();
    expect(result.messages?.length).toBe(messages.length);
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

  test("prepareStep prunes consistently across multiple steps", () => {
    // Simulate growing context across steps
    const base = buildToolHistory(30); // 91 messages
    const request = buildStreamTextRequest(makeDefaultInput(base));

    // Step 1: prune from 91 messages
    const result1 = callPrepareStep(request, 1, base);

    // Step 5: add more messages (simulating accumulated tool calls)
    const grown = [
      ...base,
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "extra1",
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
            toolCallId: "extra1",
            toolName: "shell",
            output: { text: "extra" },
          },
        ],
      } as unknown as CoreMessage,
    ];
    const result5 = callPrepareStep(request, 5, grown);

    // Both should prune, and the larger input should not produce a much
    // larger output — pruning keeps the tail window roughly constant
    const len1 = result1.messages?.length ?? 0;
    const len5 = result5.messages?.length ?? 0;
    expect(len1).toBeLessThan(base.length);
    expect(len5).toBeLessThan(grown.length);
    // The pruned sizes should be similar (within a small window)
    expect(Math.abs(len1 - len5)).toBeLessThanOrEqual(4);
  });
});
