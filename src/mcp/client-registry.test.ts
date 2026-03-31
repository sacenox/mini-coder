import { describe, expect, test } from "bun:test";
import { McpClientRegistry } from "./client-registry.ts";

describe("McpClientRegistry", () => {
  test("closes all tracked clients and clears the registry", async () => {
    const registry = new McpClientRegistry();
    const closed: string[] = [];

    registry.add({
      close: async () => {
        closed.push("one");
      },
    });
    registry.add({
      close: async () => {
        closed.push("two");
      },
    });

    await registry.closeAll();
    await registry.closeAll();

    expect(closed.sort()).toEqual(["one", "two"]);
  });

  test("continues closing other clients when one close fails", async () => {
    const registry = new McpClientRegistry();
    const closed: string[] = [];

    registry.add({
      close: async () => {
        closed.push("ok");
      },
    });
    registry.add({
      close: async () => {
        throw new Error("boom");
      },
    });

    await expect(registry.closeAll()).resolves.toBeUndefined();
    expect(closed).toEqual(["ok"]);
  });
});
