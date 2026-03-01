import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as c from "yoctocolors";
import { loadAgents } from "../cli/agents.ts";
import { type CommandContext, handleCommand } from "../cli/commands.ts";
import {
	type ImageAttachment,
	isImageFilename,
	loadImageFile,
} from "../cli/image-types.ts";
import { readline, type InputResult, watchForInterrupt } from "../cli/input.ts";
import {
	PREFIX,
	formatSubagentLabel,
	tildePath,
	writeln,
} from "../cli/output.ts";
import { loadSkills } from "../cli/skills.ts";
import type { AgentReporter } from "./reporter.ts";

import {
	getContextWindow,
	parseModelString,
	resolveModel,
} from "../llm-api/providers.ts";
import { type CoreMessage, runTurn } from "../llm-api/turn.ts";
import type { ToolDef } from "../llm-api/types.ts";
import { connectMcpServer } from "../mcp/client.ts";
import {
	type SnapshotRestoreResult,
	restoreSnapshot,
	takeSnapshot,
} from "../tools/snapshot.ts";
import type { SubagentOutput } from "../tools/subagent.ts";

import {
	deleteAllSnapshots,
	deleteLastTurn,
	deleteSnapshot,
	getConfigDir,
	getMaxTurnIndex,
	listMcpServers,
	saveMessages,
	setPreferredModel,
} from "../session/db/index.ts";

import {
	type ActiveSession,
	newSession,
	resumeSession,
	touchActiveSession,
} from "../session/manager.ts";
import { createSubagentRunner } from "./subagent-runner.ts";
import { buildReadOnlyToolSet, buildToolSet } from "./tools.ts";
import { undoLastTurn } from "./undo-snapshot.ts";

import {
	extractAssistantText,
	getGitBranch,
	hasRalphSignal,
	makeInterruptMessage,
	resolveFileRefs,
	runShellPassthrough,
} from "./agent-helpers.ts";
import { buildSystemPrompt } from "./system-prompt.ts";

import { runInputLoop } from "./input-loop.ts";
import { SessionRunner } from "./session-runner.ts";

export interface AgentOptions {
	model: string;
	cwd: string;
	sessionId?: string;
	initialPrompt?: string;
	reporter: AgentReporter;
}

export async function runAgent(opts: AgentOptions): Promise<void> {
	const cwd = opts.cwd;
	let currentModel = opts.model;

	const runSubagent = createSubagentRunner(
		cwd,
		opts.reporter,
		() => currentModel,
	);

	const agents = loadAgents(cwd);
	const tools: ToolDef[] = buildToolSet({
		cwd,
		depth: 0,
		runSubagent,
		onHook: (tool, path, ok) => opts.reporter.renderHook(tool, path, ok),
		availableAgents: agents,
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
		sessionId: opts.sessionId,
	});

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
		runSubagent: (prompt, model?) => runSubagent(prompt, 0, undefined, model),

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
		});
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
}
