import type { ToolDef } from "../llm-api/types.ts";
import type { McpClientRegistry } from "./client-registry.ts";

interface ManagedMcpClient {
  tools: ToolDef[];
  close: () => Promise<void>;
}

interface ReconnectMcpToolsOptions {
  tools: ToolDef[];
  mcpTools: ToolDef[];
  clients: McpClientRegistry;
  names: string[];
  connectByName: (name: string) => Promise<ManagedMcpClient>;
  onError?: (name: string, error: unknown) => void;
}

function removeMcpTools(tools: ToolDef[], mcpTools: ToolDef[]): void {
  for (const tool of mcpTools) {
    const index = tools.indexOf(tool);
    if (index >= 0) tools.splice(index, 1);
  }
  mcpTools.length = 0;
}

export async function reconnectMcpTools(
  opts: ReconnectMcpToolsOptions,
): Promise<void> {
  await opts.clients.closeAll();
  removeMcpTools(opts.tools, opts.mcpTools);

  for (const name of opts.names) {
    try {
      const client = await opts.connectByName(name);
      opts.clients.add(client);
      opts.tools.push(...client.tools);
      opts.mcpTools.push(...client.tools);
    } catch (error) {
      opts.onError?.(name, error);
    }
  }
}
