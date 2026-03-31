import { describe, expect, test } from "bun:test";
import { RenderedError } from "../cli/output.ts";
import { runWithTeardown } from "./run-with-teardown.ts";

describe("runWithTeardown", () => {
  test("runs teardown after success", async () => {
    const events: string[] = [];

    await runWithTeardown({
      run: async () => {
        events.push("run");
      },
      teardown: async () => {
        events.push("teardown");
      },
      renderError: () => {
        events.push("render");
      },
    });

    expect(events).toEqual(["run", "teardown"]);
  });

  test("renders once, wraps, and still tears down on ordinary errors", async () => {
    const events: string[] = [];

    await expect(
      runWithTeardown({
        run: async () => {
          events.push("run");
          throw new Error("boom");
        },
        teardown: async () => {
          events.push("teardown");
        },
        renderError: () => {
          events.push("render");
        },
      }),
    ).rejects.toBeInstanceOf(RenderedError);

    expect(events).toEqual(["run", "render", "teardown"]);
  });

  test("passes through RenderedError without double-rendering and still tears down", async () => {
    const events: string[] = [];
    const rendered = new RenderedError(new Error("already rendered"));

    await expect(
      runWithTeardown({
        run: async () => {
          events.push("run");
          throw rendered;
        },
        teardown: async () => {
          events.push("teardown");
        },
        renderError: () => {
          events.push("render");
        },
      }),
    ).rejects.toBe(rendered);

    expect(events).toEqual(["run", "teardown"]);
  });

  test("preserves the primary rendered failure when teardown also fails", async () => {
    const events: string[] = [];

    await expect(
      runWithTeardown({
        run: async () => {
          events.push("run");
          throw new Error("primary");
        },
        teardown: async () => {
          events.push("teardown");
          throw new Error("teardown");
        },
        renderError: (error) => {
          events.push(
            `render:${error instanceof Error ? error.message : String(error)}`,
          );
        },
      }),
    ).rejects.toMatchObject({
      name: "RenderedError",
      cause: expect.objectContaining({ message: "primary" }),
    });

    expect(events).toEqual(["run", "render:primary", "teardown"]);
  });
});
