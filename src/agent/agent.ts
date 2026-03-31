import * as c from "yoctocolors";
import type { CommandContext } from "../cli/types.ts";
import type { ThinkingEffort } from "../llm-api/providers.ts";
import type { ToolDef } from "../llm-api/types.ts";
import { connectMcpServer } from "../mcp/client.ts";
import { McpClientRegistry } from "../mcp/client-registry.ts";
import { reconnectMcpTools } from "../mcp/tool-sync.ts";
import {
  listMcpServers,
  setPreferredModel,
  setPreferredShowReasoning,
  setPreferredThinkingEffort,
  setPreferredVerboseOutput,
} from "../session/db/index.ts";
import type { AgentReporter } from "./reporter.ts";
import { SessionRunner } from "./session-runner.ts";
import { buildToolSet } from "./tools.ts";

interface AgentOptions {
  model: string;
  cwd: string;
  initialThinkingEffort: ThinkingEffort | null;
  initialShowReasoning: boolean;
  initialVerboseOutput: boolean;
  sessionId?: string;
  reporter: AgentReporter;
}

export async function initAgent(opts: AgentOptions): Promise<{
  runner: SessionRunner;
  cmdCtx: CommandContext;
}> {
  const cwd = opts.cwd;
  const tools: ToolDef[] = buildToolSet({ cwd });
  const mcpTools: ToolDef[] = [];
  const mcpClients = new McpClientRegistry();

  async function connectMcpClient(name: string) {
    const rows = listMcpServers();
    const row = rows.find((r) => r.name === name);
    if (!row) throw new Error(`MCP server "${name}" not found in DB`);
    const cfg: Parameters<typeof connectMcpServer>[0] = {
      name: row.name,
      transport: row.transport as "http" | "stdio",
      ...(row.url ? { url: row.url } : {}),
      ...(row.command ? { command: row.command } : {}),
      ...(row.args ? { args: JSON.parse(row.args) } : {}),
      ...(row.env ? { env: JSON.parse(row.env) } : {}),
    };
    return connectMcpServer(cfg);
  }

  async function connectAndAddMcp(name: string): Promise<void> {
    const client = await connectMcpClient(name);
    mcpClients.add(client);
    tools.push(...client.tools);
    mcpTools.push(...client.tools);
  }

  async function reconnectConfiguredMcpServers(): Promise<void> {
    await reconnectMcpTools({
      tools,
      mcpTools,
      clients: mcpClients,
      names: listMcpServers().map((row) => row.name),
      connectByName: connectMcpClient,
      onError: (name, error) => {
        opts.reporter.error(`MCP: failed to connect ${name}: ${String(error)}`);
      },
    });
  }

  for (const row of listMcpServers()) {
    try {
      await connectAndAddMcp(row.name);
      opts.reporter.info(`MCP: connected ${c.cyan(row.name)}`);
    } catch (e) {
      opts.reporter.error(`MCP: failed to connect ${row.name}: ${String(e)}`);
    }
  }

  const runner = new SessionRunner({
    cwd,
    reporter: opts.reporter,
    tools,
    mcpTools,
    initialModel: opts.model,
    initialThinkingEffort: opts.initialThinkingEffort,
    initialShowReasoning: opts.initialShowReasoning,
    initialVerboseOutput: opts.initialVerboseOutput,
    sessionId: opts.sessionId,
    onTeardown: () => mcpClients.closeAll(),
  });

  const cmdCtx: CommandContext = {
    get currentModel() {
      return runner.currentModel;
    },
    setModel: (m) => {
      runner.currentModel = m;
      runner.session.model = m;
      setPreferredModel(m);
    },
    get thinkingEffort() {
      return runner.currentThinkingEffort;
    },
    setThinkingEffort: (e) => {
      runner.currentThinkingEffort = e;
      setPreferredThinkingEffort(e);
    },
    get showReasoning() {
      return runner.showReasoning;
    },
    setShowReasoning: (show) => {
      runner.showReasoning = show;
      setPreferredShowReasoning(show);
    },
    get verboseOutput() {
      return runner.verboseOutput;
    },
    setVerboseOutput: (verbose) => {
      runner.verboseOutput = verbose;
      setPreferredVerboseOutput(verbose);
    },
    cwd,
    undoLastTurn: () => runner.undoLastTurn(),
    connectMcpServer: connectAndAddMcp,
    startSpinner: (label?: string) => opts.reporter.startSpinner(label),
    stopSpinner: () => opts.reporter.stopSpinner(),
    startNewSession: async () => {
      runner.startNewSession();
      await reconnectConfiguredMcpServers();
    },
    switchSession: async (id: string) => {
      const switched = runner.switchSession(id);
      if (!switched) return false;
      await reconnectConfiguredMcpServers();
      return true;
    },
  };

  return { runner, cmdCtx };
}
