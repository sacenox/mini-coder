import { expect, test } from "bun:test";
import { discoverMcpServers } from "./mcp.ts";

interface FakeTransport {
  close(): Promise<void>;
  url: string;
}

interface FakeToolPage {
  tools: Array<{
    description?: string;
    inputSchema: {
      properties?: Record<string, object>;
      required?: string[];
      type: "object";
    };
    name: string;
  }>;
  nextCursor?: string;
}

type FakeToolResult =
  | {
      content: Array<
        | {
            type: "text";
            text: string;
          }
        | {
            type: "image";
            data: string;
            mimeType: string;
          }
      >;
      structuredContent?: unknown;
      isError?: boolean;
    }
  | {
      toolResult: unknown;
    };

interface FakeServerBehavior {
  closeCalls: number;
  connectError?: Error;
  pages?: FakeToolPage[];
  results?: Record<string, FakeToolResult | Error>;
  toolCalls: Array<{
    arguments?: Record<string, unknown>;
    name: string;
  }>;
}

function createFakeRuntime(servers: Record<string, FakeServerBehavior>) {
  return {
    createTransport(url: URL): FakeTransport {
      const behavior = servers[url.toString()];
      if (!behavior) {
        throw new Error(`Unexpected MCP URL in test: ${url}`);
      }

      return {
        url: url.toString(),
        close: async () => {
          behavior.closeCalls += 1;
        },
      };
    },
    createClient() {
      let behavior: FakeServerBehavior | null = null;
      let pageIndex = 0;

      return {
        async connect(transport: FakeTransport) {
          behavior = servers[transport.url] ?? null;
          if (!behavior) {
            throw new Error(
              `Unexpected MCP transport in test: ${transport.url}`,
            );
          }
          if (behavior.connectError) {
            throw behavior.connectError;
          }
        },
        async listTools() {
          if (!behavior) {
            throw new Error("MCP client used before connect");
          }

          const page = behavior.pages?.[pageIndex] ?? { tools: [] };
          pageIndex += 1;
          return page;
        },
        async callTool(params: {
          arguments?: Record<string, unknown>;
          name: string;
        }) {
          if (!behavior) {
            throw new Error("MCP client used before connect");
          }

          behavior.toolCalls.push(params);
          const result = behavior.results?.[params.name];
          if (result instanceof Error) {
            throw result;
          }
          return result ?? { content: [] };
        },
      };
    },
  };
}

test("discoverMcpServers_reachableServer_importsPrefixedToolsAndExecutesCalls", async () => {
  const behavior: FakeServerBehavior = {
    closeCalls: 0,
    pages: [
      {
        tools: [
          {
            name: "search",
            description: "Search the docs",
            inputSchema: {
              type: "object",
              properties: {
                query: { type: "string" },
              },
              required: ["query"],
            },
          },
        ],
      },
    ],
    results: {
      search: {
        content: [{ type: "text", text: "Found it" }],
      },
    },
    toolCalls: [],
  };

  const result = await discoverMcpServers(
    {
      servers: [{ name: "docs", url: "http://docs.test/mcp" }],
    },
    createFakeRuntime({ "http://docs.test/mcp": behavior }),
  );

  expect(result.warnings).toEqual([]);
  expect(result.servers).toHaveLength(1);

  const server = result.servers[0]!;
  expect(server.name).toBe("docs");
  expect(server.enabled).toBe(true);
  expect(server.tools.map((tool) => tool.name)).toEqual(["docs__search"]);
  expect(server.tools[0]?.description).toBe("[MCP docs] Search the docs");

  const handler = server.toolHandlers.get("docs__search");
  expect(handler).toBeDefined();
  await expect(handler!({}, "/tmp")).rejects.toThrow(/Validation failed/);

  const toolResult = await handler!({ query: "routing" }, "/tmp");
  expect(toolResult).toEqual({
    content: [{ type: "text", text: "Found it" }],
    details: undefined,
    isError: false,
  });
  expect(behavior.toolCalls).toEqual([
    {
      name: "search",
      arguments: { query: "routing" },
    },
  ]);
});

test("discoverMcpServers_structuredFallbackResult_formatsStructuredContent", async () => {
  const behavior: FakeServerBehavior = {
    closeCalls: 0,
    pages: [
      {
        tools: [
          {
            name: "inspect",
            inputSchema: {
              type: "object",
              properties: {},
            },
          },
        ],
      },
    ],
    results: {
      inspect: {
        content: [],
        structuredContent: { ok: true, count: 2 },
        isError: true,
      },
    },
    toolCalls: [],
  };

  const result = await discoverMcpServers(
    {
      servers: [{ name: "state", url: "http://state.test/mcp" }],
    },
    createFakeRuntime({ "http://state.test/mcp": behavior }),
  );

  const handler = result.servers[0]?.toolHandlers.get("state__inspect");
  const toolResult = await handler!({}, "/tmp");

  expect(toolResult).toEqual({
    content: [
      {
        type: "text",
        text: JSON.stringify({ ok: true, count: 2 }, null, 2),
      },
    ],
    details: { structuredContent: { ok: true, count: 2 } },
    isError: true,
  });
});

test("discoverMcpServers_invalidOrUnusableServers_skipsThemWithWarningsAndCleanup", async () => {
  const emptyBehavior: FakeServerBehavior = {
    closeCalls: 0,
    pages: [{ tools: [] }],
    toolCalls: [],
  };
  const failingBehavior: FakeServerBehavior = {
    closeCalls: 0,
    connectError: new Error("connect failed"),
    toolCalls: [],
  };

  const result = await discoverMcpServers(
    {
      servers: [
        { name: "bad-url", url: "not-a-url" },
        { name: "empty", url: "http://empty.test/mcp" },
        { name: "down", url: "http://down.test/mcp" },
      ],
    },
    createFakeRuntime({
      "http://empty.test/mcp": emptyBehavior,
      "http://down.test/mcp": failingBehavior,
    }),
  );

  expect(result.servers).toEqual([]);
  expect(result.warnings).toEqual([
    'MCP server "bad-url": invalid URL (not-a-url)',
    'MCP server "empty" exposes no tools and was skipped.',
    'MCP server "down": connect failed (http://down.test/mcp)',
  ]);
  expect(emptyBehavior.closeCalls).toBe(1);
  expect(failingBehavior.closeCalls).toBe(1);
});
