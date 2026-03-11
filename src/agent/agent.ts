import * as c from "yoctocolors";
import { type AgentConfig, loadAgents } from "../cli/agents.ts";
import type { CommandContext } from "../cli/commands.ts";
import { tildePath } from "../cli/output.ts";
import { getContextWindow, type ThinkingEffort } from "../llm-api/providers.ts";
import type { ToolDef } from "../llm-api/types.ts";
import { connectMcpServer } from "../mcp/client.ts";
import {
	getPreferredActiveAgent,
	listMcpServers,
	setPreferredActiveAgent,
	setPreferredModel,
	setPreferredThinkingEffort,
} from "../session/db/index.ts";
import type { SubagentSummary } from "../tools/subagent.ts";
import { getGitBranch } from "./agent-helpers.ts";
import { runInputLoop } from "./input-loop.ts";
import type { AgentReporter } from "./reporter.ts";
import { SessionRunner } from "./session-runner.ts";
import { createSubagentRunner } from "./subagent-runner.ts";
import { buildToolSet } from "./tools.ts";
import { undoLastTurn } from "./undo-snapshot.ts";

interface AgentOptions {
	model: string;
	cwd: string;
	initialThinkingEffort: ThinkingEffort | null;
	sessionId?: string;
	initialPrompt?: string;
	reporter: AgentReporter;
	headless?: boolean;
	agentSystemPrompt?: string;
}

/** Agents with mode "primary" are for interactive use only — exclude from subagent tool. */
function subagentAgents(
	agents: Map<string, AgentConfig>,
): Map<string, AgentConfig> {
	const filtered = new Map<string, AgentConfig>();
	for (const [name, cfg] of agents) {
		if (cfg.mode !== "primary") filtered.set(name, cfg);
	}
	return filtered;
}

export async function runAgent(
	opts: AgentOptions,
): Promise<SubagentSummary | undefined> {
	const cwd = opts.cwd;
	let currentModel = opts.model;

	const { runSubagent, killAll } = createSubagentRunner(
		cwd,
		() => currentModel,
	);
	const agents = loadAgents(cwd);
	const tools: ToolDef[] = buildToolSet({
		cwd,
		runSubagent,
		onHook: (tool, path, ok) => opts.reporter.renderHook(tool, path, ok),
		availableAgents: subagentAgents(agents),
	});

	const mcpTools: ToolDef[] = [];

	async function connectAndAddMcp(name: string): Promise<void> {
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
		const client = await connectMcpServer(cfg);
		tools.push(...client.tools);
		mcpTools.push(...client.tools);
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
		initialModel: currentModel,
		initialThinkingEffort: opts.initialThinkingEffort,
		sessionId: opts.sessionId,
		extraSystemPrompt: opts.agentSystemPrompt,
		isSubagent: opts.headless,
		killSubprocesses: killAll,
	});

	// Active primary agent state — name only; the system prompt is stored on runner.
	let activeAgentName: string | null = getPreferredActiveAgent();
	if (opts.agentSystemPrompt) {
		activeAgentName = null;
	} else if (activeAgentName) {
		const agentCfg = agents.get(activeAgentName);
		if (agentCfg) {
			runner.extraSystemPrompt = agentCfg.systemPrompt;
		} else {
			activeAgentName = null;
			setPreferredActiveAgent(null);
		}
	}

	const cmdCtx: CommandContext = {
		get currentModel() {
			return runner.currentModel;
		},
		setModel: (m) => {
			runner.currentModel = m;
			runner.session.model = m;
			setPreferredModel(m);
			currentModel = m; // Update local reference for runSubagent
		},
		get thinkingEffort() {
			return runner.currentThinkingEffort;
		},
		setThinkingEffort: (e) => {
			runner.currentThinkingEffort = e;
			setPreferredThinkingEffort(e);
		},
		get planMode() {
			return runner.planMode;
		},
		get ralphMode() {
			return runner.ralphMode;
		},
		setRalphMode: (v) => {
			runner.ralphMode = v;
		},
		setPlanMode: (v) => {
			runner.planMode = v;
		},
		cwd,
		runSubagent: (prompt, agentName?, model?) =>
			runSubagent(prompt, agentName, model),

		get activeAgent() {
			return activeAgentName;
		},
		setActiveAgent: (name, systemPrompt?) => {
			activeAgentName = name;
			runner.extraSystemPrompt = systemPrompt;
			setPreferredActiveAgent(name);
		},

		undoLastTurn: () =>
			undoLastTurn({
				session: runner.session,
				coreHistory: runner.coreHistory,
				snapshotStack: runner.snapshotStack,
				getTurnIndex: () => runner.turnIndex,
				setTurnIndex: (idx) => {
					runner.turnIndex = idx;
				},
				cwd,
				reporter: opts.reporter,
			}),
		connectMcpServer: connectAndAddMcp,
		startSpinner: (label?: string) => opts.reporter.startSpinner(label),
		stopSpinner: () => opts.reporter.stopSpinner(),
		startNewSession: () => runner.startNewSession(),
	};

	async function renderStatusBarForSession(): Promise<void> {
		const branch = await getGitBranch(cwd);
		const provider = runner.currentModel.split("/")[0] ?? "";
		const modelShort = runner.currentModel.split("/").slice(1).join("/");
		const cwdDisplay = tildePath(cwd);

		opts.reporter.renderStatusBar({
			model: modelShort,
			provider,
			cwd: cwdDisplay,
			gitBranch: branch,
			sessionId: runner.session.id,
			inputTokens: runner.totalIn,
			outputTokens: runner.totalOut,
			contextTokens: runner.lastContextTokens,
			contextWindow: getContextWindow(runner.currentModel) ?? 0,
			ralphMode: runner.ralphMode,
			thinkingEffort: runner.currentThinkingEffort,
			activeAgent: activeAgentName,
		});
	}

	if (opts.headless) {
		const prompt = opts.initialPrompt ?? "";
		const result = await runner.processUserInput(prompt);
		return {
			result,
			inputTokens: runner.totalIn,
			outputTokens: runner.totalOut,
		};
	}

	if (opts.initialPrompt) {
		await runner.processUserInput(opts.initialPrompt);
	}

	await runInputLoop({
		cwd,
		reporter: opts.reporter,
		cmdCtx,
		runner,
		renderStatusBar: renderStatusBarForSession,
	});

	return undefined;
}
