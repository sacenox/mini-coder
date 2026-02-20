import { join } from "path";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { getConfigDir } from "../session/db.ts";
import { connectMcpServer, type McpServerConfig, type McpClient } from "./client.ts";
import type { ToolDef } from "../llm-api/types.ts";

// ─── Config persistence ───────────────────────────────────────────────────────

function getMcpConfigPath(): string {
  return join(getConfigDir(), "mcp.json");
}

export function loadMcpConfig(): McpServerConfig[] {
  const path = getMcpConfigPath();
  if (!existsSync(path)) return [];
  try {
    const raw = readFileSync(path, "utf-8");
    return JSON.parse(raw) as McpServerConfig[];
  } catch {
    return [];
  }
}

export function saveMcpConfig(servers: McpServerConfig[]): void {
  const dir = getConfigDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(getMcpConfigPath(), JSON.stringify(servers, null, 2));
}

export function addMcpConfig(server: McpServerConfig): void {
  const servers = loadMcpConfig();
  const existing = servers.findIndex((s) => s.name === server.name);
  if (existing !== -1) servers[existing] = server;
  else servers.push(server);
  saveMcpConfig(servers);
}

export function removeMcpConfig(name: string): void {
  const servers = loadMcpConfig().filter((s) => s.name !== name);
  saveMcpConfig(servers);
}

// ─── Active connections ───────────────────────────────────────────────────────

const _activeClients: Map<string, McpClient> = new Map();

/**
 * Connect to all configured MCP servers, return their combined tools.
 */
export async function connectAllMcp(): Promise<ToolDef[]> {
  const configs = loadMcpConfig();
  const allTools: ToolDef[] = [];

  for (const config of configs) {
    try {
      if (!_activeClients.has(config.name)) {
        const client = await connectMcpServer(config);
        _activeClients.set(config.name, client);
      }
      const client = _activeClients.get(config.name)!;
      allTools.push(...client.tools);
    } catch (err) {
      console.error(
        `[mcp] Failed to connect to "${config.name}":`,
        err instanceof Error ? err.message : err
      );
    }
  }

  return allTools;
}

/**
 * Close all active MCP connections.
 */
export async function closeAllMcp(): Promise<void> {
  for (const client of _activeClients.values()) {
    try {
      await client.close();
    } catch { /* ignore */ }
  }
  _activeClients.clear();
}
