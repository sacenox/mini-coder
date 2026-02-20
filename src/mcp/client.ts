import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { ToolDef } from "../llm-api/types.ts";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface McpServerConfig {
	name: string;
	/** "http" uses StreamableHTTP (with SSE fallback); "stdio" spawns a process */
	transport: "http" | "stdio";
	url?: string; // for http transport
	command?: string; // for stdio transport
	args?: string[]; // for stdio transport
	env?: Record<string, string>;
}

export interface McpClient {
	name: string;
	tools: ToolDef[];
	close: () => Promise<void>;
}

// ─── Connect to a single MCP server ──────────────────────────────────────────

export async function connectMcpServer(
	config: McpServerConfig,
): Promise<McpClient> {
	const client = new Client({ name: "mini-coder", version: "0.1.0" });

	if (config.transport === "http") {
		if (!config.url) {
			throw new Error(`MCP server "${config.name}" requires a url`);
		}

		const url = new URL(config.url);

		// Try StreamableHTTP first (current spec), fall back to legacy SSE
		let transport: Transport;
		try {
			const streamable = new StreamableHTTPClientTransport(url);
			// Cast to satisfy exactOptionalPropertyTypes mismatch between SDK and our tsconfig
			transport = streamable as unknown as Transport;
			await client.connect(transport);
		} catch {
			// Server may be using the older SSE transport
			transport = new SSEClientTransport(url) as unknown as Transport;
			await client.connect(transport);
		}
	} else if (config.transport === "stdio") {
		if (!config.command) {
			throw new Error(`MCP server "${config.name}" requires a command`);
		}

		// Only pass env when defined — exactOptionalPropertyTypes requires no undefined values
		const stdioParams = config.env
			? { command: config.command, args: config.args ?? [], env: config.env }
			: { command: config.command, args: config.args ?? [] };

		const transport = new StdioClientTransport(
			stdioParams,
		) as unknown as Transport;
		await client.connect(transport);
	} else {
		throw new Error(
			`Unknown MCP transport: ${(config as McpServerConfig).transport}`,
		);
	}

	// List tools and build ToolDef wrappers
	const { tools: mcpTools } = await client.listTools();

	const tools: ToolDef[] = mcpTools.map((t) => ({
		name: `mcp_${config.name}_${t.name}`,
		description: `[MCP:${config.name}] ${t.description ?? t.name}`,
		// Use the server's declared JSON schema directly
		schema: t.inputSchema,
		execute: async (input: unknown) => {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const result = (await client.callTool({
				name: t.name,
				arguments: input as Record<string, unknown>,
			})) as { isError?: boolean; content: unknown };

			if (result.isError) {
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				const content = result.content as Array<{
					type: string;
					text?: string;
				}>;
				const errText = content
					.filter((b) => b.type === "text")
					.map((b) => b.text ?? "")
					.join("\n");
				throw new Error(errText || "MCP tool returned an error");
			}

			// Return full content array so rich results (images, etc.) are preserved
			return result.content;
		},
	}));

	return {
		name: config.name,
		tools,
		close: () => client.close(),
	};
}
