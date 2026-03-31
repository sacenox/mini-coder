import { describe, expect, test } from "bun:test";
import { z } from "zod";
import type { ToolDef } from "../llm-api/types.ts";
import { McpClientRegistry } from "./client-registry.ts";
import { reconnectMcpTools } from "./tool-sync.ts";

function makeTool(name: string): ToolDef {
  return {
    name,
    description: name,
    schema: z.object({}),
    execute: async () => null,
  };
}

describe("reconnectMcpTools", () => {
  test("closes old clients, replaces MCP tools, and keeps base tools", async () => {
    const oldMcpTool = makeTool("mcp_old");
    const tools = [makeTool("shell"), oldMcpTool];
    const mcpTools = [oldMcpTool];
    const clients = new McpClientRegistry();
    const closed: string[] = [];

    clients.add({
      close: async () => {
        closed.push("old");
      },
    });

    await reconnectMcpTools({
      tools,
      mcpTools,
      clients,
      names: ["alpha", "beta"],
      connectByName: async (name) => ({
        tools: [makeTool(`mcp_${name}`)],
        close: async () => {
          closed.push(name);
        },
      }),
    });

    expect(closed).toEqual(["old"]);
    expect(tools.map((tool) => tool.name)).toEqual([
      "shell",
      "mcp_alpha",
      "mcp_beta",
    ]);
    expect(mcpTools.map((tool) => tool.name)).toEqual([
      "mcp_alpha",
      "mcp_beta",
    ]);
  });

  test("continues reconnecting after per-server failures", async () => {
    const tools = [makeTool("shell")];
    const mcpTools: ToolDef[] = [];
    const clients = new McpClientRegistry();
    const errors: string[] = [];

    await reconnectMcpTools({
      tools,
      mcpTools,
      clients,
      names: ["broken", "ok"],
      connectByName: async (name) => {
        if (name === "broken") throw new Error("boom");
        return {
          tools: [makeTool("mcp_ok")],
          close: async () => {},
        };
      },
      onError: (name, error) => {
        errors.push(`${name}:${String(error)}`);
      },
    });

    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("broken");
    expect(tools.map((tool) => tool.name)).toEqual(["shell", "mcp_ok"]);
    expect(mcpTools.map((tool) => tool.name)).toEqual(["mcp_ok"]);
  });
});
