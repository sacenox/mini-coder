/**
 * Model Context Protocol client discovery and tool integration.
 *
 * mini-coder tracks configured Streamable HTTP MCP servers, connects enabled
 * ones when needed, imports their tools, and exposes those tools through the
 * normal pi-ai tool interface.
 *
 * @module
 */

import type { Static, Tool, ToolCall, TSchema } from "@mariozechner/pi-ai";
import { Type, validateToolArguments } from "@mariozechner/pi-ai";
import { Client } from "@modelcontextprotocol/sdk/client";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { ToolHandler, ToolUpdateCallback } from "./agent.ts";
import { getErrorMessage } from "./errors.ts";
import type { McpSettings } from "./settings.ts";
import { type ToolExecResult, textResult } from "./tool-common.ts";

const MCP_DISCOVERY_TIMEOUT_MS = 3_000;

interface McpListedTool {
  /** JSON Schema describing the tool input object. */
  inputSchema: {
    properties?: Record<string, object>;
    required?: string[];
    type: "object";
    [key: string]: unknown;
  };
  /** Human-readable tool description when provided by the server. */
  description?: string;
  /** Server-defined MCP tool name. */
  name: string;
}

type McpCallToolResult =
  | {
      /** Tool content blocks returned by the MCP server. */
      content: McpToolResultContent[];
      /** Optional structured data returned alongside content. */
      structuredContent?: unknown;
      /** Whether the server marked this result as an error. */
      isError?: boolean;
    }
  | {
      /** Compatibility payload from older MCP tool result formats. */
      toolResult: unknown;
    };

type McpToolResultContent =
  | {
      type: "text";
      text: string;
    }
  | {
      type: "image";
      data: string;
      mimeType: string;
    }
  | {
      type: "audio";
      data: string;
      mimeType: string;
    }
  | {
      type: "resource";
      resource:
        | {
            uri: string;
            text: string;
            mimeType?: string;
          }
        | {
            uri: string;
            blob: string;
            mimeType?: string;
          };
    }
  | {
      type: "resource_link";
      uri: string;
      name: string;
      description?: string;
      mimeType?: string;
      size?: number;
      title?: string;
    };

type McpProgress = {
  /** Current completed work units reported by the server. */
  progress: number;
  /** Total work units when the server reports them. */
  total?: number;
  /** Optional human-readable progress message. */
  message?: string;
};

interface McpTransportLike {
  close(): Promise<void>;
}

interface McpClientLike {
  connect(
    transport: McpTransportLike,
    options?: { timeout?: number },
  ): Promise<void>;
  listTools(
    params?: { cursor?: string },
    options?: { timeout?: number },
  ): Promise<{
    tools: McpListedTool[];
    nextCursor?: string;
  }>;
  callTool(
    params: {
      name: string;
      arguments?: Record<string, unknown>;
    },
    resultSchema?: undefined,
    options?: {
      signal?: AbortSignal;
      onprogress?: (progress: McpProgress) => void;
    },
  ): Promise<McpCallToolResult>;
}

interface McpRuntime {
  createClient(): McpClientLike;
  createTransport(url: URL): McpTransportLike;
}

const defaultMcpRuntime: McpRuntime = {
  createClient() {
    return new Client(
      {
        name: "mini-coder",
        version: "0.0.0",
      },
      { capabilities: {} },
    );
  },
  createTransport(url) {
    return new StreamableHTTPClientTransport(url);
  },
};

async function noopClose(): Promise<void> {}

/** A configured MCP server and its current runtime connection state. */
export interface McpServerState {
  /** User-configured server identifier from `settings.json`. */
  name: string;
  /** Absolute Streamable HTTP endpoint URL. */
  url: string;
  /** Whether this server should be available to future turns. */
  enabled: boolean;
  /** Whether mini-coder currently has an active connection to this server. */
  connected: boolean;
  /** pi-ai tool definitions derived from the server's tool list. */
  tools: Tool[];
  /** Tool name → handler map for calling the remote MCP tools. */
  toolHandlers: Map<string, ToolHandler>;
  /** Close the underlying MCP transport when connected. */
  close(): Promise<void>;
}

interface McpConnectionState {
  /** Non-fatal warnings encountered while importing tools. */
  warnings: string[];
  /** pi-ai tool definitions derived from the server's tool list. */
  tools: Tool[];
  /** Tool name → handler map for calling the remote MCP tools. */
  toolHandlers: Map<string, ToolHandler>;
  /** Close the underlying MCP transport. */
  close(): Promise<void>;
}

interface McpDiscoveryResult {
  /** MCP servers kept in runtime state after startup discovery. */
  servers: McpServerState[];
  /** Non-fatal startup warnings for skipped or unreachable servers. */
  warnings: string[];
}

function createDisconnectedMcpServer(
  entry: NonNullable<McpSettings["servers"]>[number],
): McpServerState {
  return {
    name: entry.name,
    url: entry.url,
    enabled: entry.enabled,
    connected: false,
    tools: [],
    toolHandlers: new Map(),
    close: noopClose,
  };
}

function resetMcpServerConnection(server: McpServerState): void {
  server.connected = false;
  server.tools = [];
  server.toolHandlers = new Map();
  server.close = noopClose;
}

function parseMcpServerUrl(rawUrl: string): URL | null {
  try {
    return new URL(rawUrl);
  } catch {
    return null;
  }
}

/**
 * Connect a configured MCP server and populate its imported tools.
 *
 * On failure the server is left disconnected and the returned warnings describe
 * why the connection was skipped.
 *
 * @param server - Runtime MCP server state to connect.
 * @param runtime - Internal runtime injection for tests.
 * @returns Non-fatal warnings produced while connecting or importing tools.
 */
export async function connectMcpServer(
  server: McpServerState,
  runtime: McpRuntime = defaultMcpRuntime,
): Promise<string[]> {
  if (server.connected) {
    return [];
  }

  const connection = await createMcpServerConnection(
    server.name,
    server.url,
    runtime,
  );

  if (!("tools" in connection)) {
    resetMcpServerConnection(server);
    return [connection.warning];
  }

  server.connected = true;
  server.tools = connection.tools;
  server.toolHandlers = connection.toolHandlers;
  server.close = connection.close;
  return connection.warnings;
}

/**
 * Disconnect an MCP server and clear its imported tool state.
 *
 * @param server - Runtime MCP server state to disconnect.
 */
export async function disconnectMcpServer(
  server: McpServerState,
): Promise<void> {
  if (!server.connected) {
    return;
  }

  const close = server.close;
  resetMcpServerConnection(server);
  await close();
}

/**
 * Connect enabled MCP servers at startup while keeping disabled ones in state.
 *
 * Invalid or unreachable servers do not fail startup. Enabled servers that
 * cannot connect are skipped with warnings. Disabled servers stay disconnected
 * until the user turns them back on.
 *
 * @param settings - Optional MCP settings from `settings.json`.
 * @param runtime - Internal runtime injection for tests.
 * @returns MCP server state plus any non-fatal startup warnings.
 */
export async function discoverMcpServers(
  settings: McpSettings | undefined,
  runtime: McpRuntime = defaultMcpRuntime,
): Promise<McpDiscoveryResult> {
  const servers: McpServerState[] = [];
  const warnings: string[] = [];

  for (const entry of settings?.servers ?? []) {
    if (!parseMcpServerUrl(entry.url)) {
      warnings.push(`MCP server "${entry.name}": invalid URL (${entry.url})`);
      continue;
    }

    const server = createDisconnectedMcpServer(entry);
    if (!entry.enabled) {
      servers.push(server);
      continue;
    }

    const connectWarnings = await connectMcpServer(server, runtime);
    warnings.push(...connectWarnings);
    if (!server.connected) {
      continue;
    }

    servers.push(server);
  }

  return { servers, warnings };
}

async function createMcpServerConnection(
  serverName: string,
  serverUrl: string,
  runtime: McpRuntime,
): Promise<McpConnectionState | { warning: string }> {
  const url = parseMcpServerUrl(serverUrl);
  if (!url) {
    return {
      warning: `MCP server "${serverName}": invalid URL (${serverUrl})`,
    };
  }

  const transport = runtime.createTransport(url);
  const client = runtime.createClient();

  try {
    await client.connect(transport, { timeout: MCP_DISCOVERY_TIMEOUT_MS });
    const listedTools = await listAllTools(client);

    if (listedTools.length === 0) {
      await closeQuietly(transport);
      return {
        warning: `MCP server "${serverName}" exposes no tools and was skipped.`,
      };
    }

    const warnings: string[] = [];
    const tools: Tool[] = [];
    const toolHandlers = new Map<string, ToolHandler>();

    for (const listedTool of listedTools) {
      const { tool, handler } = createMcpTool(serverName, listedTool, client);
      if (toolHandlers.has(tool.name)) {
        warnings.push(
          `MCP server "${serverName}": duplicate tool name "${listedTool.name}" was skipped.`,
        );
        continue;
      }
      tools.push(tool);
      toolHandlers.set(tool.name, handler);
    }

    if (tools.length === 0) {
      await closeQuietly(transport);
      return {
        warning: `MCP server "${serverName}" exposes no usable tools and was skipped.`,
      };
    }

    return {
      warnings,
      tools,
      toolHandlers,
      close: () => transport.close(),
    };
  } catch (error) {
    await closeQuietly(transport);
    return {
      warning: `MCP server "${serverName}": ${getErrorMessage(error)} (${serverUrl})`,
    };
  }
}

async function listAllTools(client: McpClientLike): Promise<McpListedTool[]> {
  const tools: McpListedTool[] = [];
  let cursor: string | undefined;

  do {
    const page = await client.listTools(cursor ? { cursor } : undefined, {
      timeout: MCP_DISCOVERY_TIMEOUT_MS,
    });
    tools.push(...page.tools);
    cursor = page.nextCursor;
  } while (cursor);

  return tools;
}

function createMcpTool(
  serverName: string,
  listedTool: McpListedTool,
  client: McpClientLike,
): {
  tool: Tool;
  handler: ToolHandler;
} {
  const toolName = `${serverName}__${listedTool.name}`;
  const tool: Tool = {
    name: toolName,
    description: listedTool.description
      ? `[MCP ${serverName}] ${listedTool.description}`
      : `[MCP ${serverName}] ${listedTool.name}`,
    parameters: Type.Unsafe<Record<string, unknown>>(listedTool.inputSchema),
  };

  const handler: ToolHandler = async (args, _cwd, signal, onUpdate) => {
    const validatedArgs = validateMcpToolArgs(tool, args) as Record<
      string,
      unknown
    >;

    try {
      const result = await client.callTool(
        {
          name: listedTool.name,
          arguments: validatedArgs,
        },
        undefined,
        {
          ...(signal ? { signal } : {}),
          ...(onUpdate
            ? {
                onprogress: (progress: McpProgress) => {
                  emitMcpProgressUpdate(
                    serverName,
                    listedTool.name,
                    progress,
                    onUpdate,
                  );
                },
              }
            : {}),
        },
      );

      return convertMcpToolResult(result);
    } catch (error) {
      return textResult(
        `MCP server "${serverName}" tool "${listedTool.name}" failed: ${getErrorMessage(error)}`,
        true,
      );
    }
  };

  return { tool, handler };
}

function emitMcpProgressUpdate(
  serverName: string,
  toolName: string,
  progress: McpProgress,
  onUpdate: ToolUpdateCallback,
): void {
  const status =
    progress.total != null
      ? `${progress.progress}/${progress.total}`
      : `${progress.progress}`;
  const suffix = progress.message ? ` — ${progress.message}` : "";
  onUpdate(
    textResult(
      `MCP ${serverName}/${toolName} progress: ${status}${suffix}`,
      false,
    ),
  );
}

function convertMcpToolResult(result: McpCallToolResult): ToolExecResult {
  if ("toolResult" in result) {
    return textResult(formatUnknownValue(result.toolResult), false);
  }

  const content: ToolExecResult["content"] = [];

  for (const item of result.content) {
    switch (item.type) {
      case "text":
        content.push({ type: "text", text: item.text });
        break;
      case "image":
        content.push({
          type: "image",
          data: item.data,
          mimeType: item.mimeType,
        });
        break;
      case "audio":
        content.push({
          type: "text",
          text: `Audio output (${item.mimeType}) is not renderable in mini-coder tool results.`,
        });
        break;
      case "resource":
        content.push({
          type: "text",
          text: formatResourceContent(item.resource),
        });
        break;
      case "resource_link":
        content.push({
          type: "text",
          text: formatResourceLinkContent(item),
        });
        break;
    }
  }

  if (content.length === 0) {
    if (result.structuredContent !== undefined) {
      content.push({
        type: "text",
        text: formatUnknownValue(result.structuredContent),
      });
    } else {
      content.push({
        type: "text",
        text: "MCP tool returned no content.",
      });
    }
  }

  return {
    content,
    details:
      result.structuredContent === undefined
        ? undefined
        : { structuredContent: result.structuredContent },
    isError: result.isError ?? false,
  };
}

function formatResourceContent(
  resource:
    | {
        uri: string;
        text: string;
        mimeType?: string;
      }
    | {
        uri: string;
        blob: string;
        mimeType?: string;
      },
): string {
  if ("text" in resource) {
    return resource.mimeType
      ? `Resource ${resource.uri} (${resource.mimeType})\n\n${resource.text}`
      : `Resource ${resource.uri}\n\n${resource.text}`;
  }

  return resource.mimeType
    ? `Resource blob ${resource.uri} (${resource.mimeType})`
    : `Resource blob ${resource.uri}`;
}

function formatResourceLinkContent(item: {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
  size?: number;
  title?: string;
}): string {
  const lines = [
    item.title ? `Resource link: ${item.title}` : `Resource link: ${item.name}`,
    `URI: ${item.uri}`,
  ];

  if (item.description) {
    lines.push(`Description: ${item.description}`);
  }
  if (item.mimeType) {
    lines.push(`MIME type: ${item.mimeType}`);
  }
  if (item.size != null) {
    lines.push(`Size: ${item.size}`);
  }

  return lines.join("\n");
}

function formatUnknownValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function validateMcpToolArgs<TParameters extends TSchema>(
  tool: Tool<TParameters>,
  args: Record<string, unknown>,
): Static<TParameters> {
  return validateToolArguments(tool, {
    type: "toolCall",
    id: tool.name,
    name: tool.name,
    arguments: args,
  } satisfies ToolCall) as Static<TParameters>;
}

async function closeQuietly(transport: McpTransportLike): Promise<void> {
  try {
    await transport.close();
  } catch {
    // Best effort only.
  }
}
