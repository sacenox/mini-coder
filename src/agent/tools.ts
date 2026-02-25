import type { ToolDef } from "../llm-api/types.ts";
import type { CreateOutput } from "../tools/create.ts";
import { createTool } from "../tools/create.ts";
import type { GlobOutput } from "../tools/glob.ts";
import { globTool } from "../tools/glob.ts";
import type { GrepOutput } from "../tools/grep.ts";
import { grepTool } from "../tools/grep.ts";
import {
	createHookCache,
	hookEnvForCreate,
	hookEnvForGlob,
	hookEnvForGrep,
	hookEnvForInsert,
	hookEnvForRead,
	hookEnvForReplace,
	hookEnvForShell,
	runHook,
} from "../tools/hooks.ts";
import type { InsertOutput } from "../tools/insert.ts";
import { insertTool } from "../tools/insert.ts";
import type { ReadOutput } from "../tools/read.ts";
import { readTool } from "../tools/read.ts";
import type { ReplaceOutput } from "../tools/replace.ts";
import { replaceTool } from "../tools/replace.ts";
import type { ShellOutput } from "../tools/shell.ts";
import { shellTool } from "../tools/shell.ts";
import { createSubagentTool } from "../tools/subagent.ts";

// ─── Tool wrappers ────────────────────────────────────────────────────────────

/**
 * Inject a default cwd if not provided by the LLM.
 */
function withCwdDefault(tool: ToolDef, cwd: string): ToolDef {
	const originalExecute = tool.execute;
	return {
		...tool,
		execute: async (input: unknown) => {
			const withDefault = {
				cwd,
				...(typeof input === "object" && input ? input : {}),
			};
			return originalExecute(withDefault);
		},
	};
}

type EnvBuilder<TInput, TOutput> = (
	result: TOutput,
	input: TInput,
) => Record<string, string>;

/**
 * Wrap a tool to fire its post-hook (if one exists) after each successful execute.
 * Hooks are looked up via the session-scoped cache — no filesystem access per call.
 * Errors are always swallowed. onHook is called with the result so the caller can
 * render a UI line.
 */
function withHooks<TInput extends { cwd?: string }, TOutput>(
	tool: ToolDef<TInput, TOutput>,
	lookupHook: (toolName: string) => string | null,
	cwd: string,
	buildEnv: EnvBuilder<TInput, TOutput>,
	onHook: (toolName: string, scriptPath: string, success: boolean) => void,
): ToolDef<TInput, TOutput> {
	const originalExecute = tool.execute;
	return {
		...tool,
		execute: async (input: TInput) => {
			const result = await originalExecute(input);
			const hookScript = lookupHook(tool.name);
			if (hookScript) {
				const env = buildEnv(result, input);
				const success = await runHook(hookScript, env, cwd);
				onHook(tool.name, hookScript, success);
			}
			return result;
		},
	};
}

// ─── Tool registry ────────────────────────────────────────────────────────────

export const MAX_SUBAGENT_DEPTH = 3;

// Names of all local tools that support hooks (MCP tools are excluded).
const HOOKABLE_TOOLS = [
	"glob",
	"grep",
	"read",
	"create",
	"replace",
	"insert",
	"shell",
];

export function buildToolSet(opts: {
	cwd: string;
	depth?: number;
	runSubagent: (
		prompt: string,
		depth?: number,
		agentName?: string,
	) => Promise<import("../tools/subagent.ts").SubagentOutput>;

	onHook: (toolName: string, scriptPath: string, success: boolean) => void;
	availableAgents: ReadonlyMap<string, { description: string }>;
}): ToolDef[] {
	const { cwd, onHook } = opts;
	const depth = opts.depth ?? 0;
	const lookupHook = createHookCache(HOOKABLE_TOOLS, cwd);

	return [
		// Read-only: discover and inspect files
		withHooks(
			withCwdDefault(globTool as ToolDef, cwd) as ToolDef<
				{ cwd?: string; pattern: string },
				GlobOutput
			>,
			lookupHook,
			cwd,
			(_, input) => hookEnvForGlob(input, cwd),
			onHook,
		) as ToolDef,
		withHooks(
			withCwdDefault(grepTool as ToolDef, cwd) as ToolDef<
				{ cwd?: string; pattern: string },
				GrepOutput
			>,
			lookupHook,
			cwd,
			(_, input) => hookEnvForGrep(input, cwd),
			onHook,
		) as ToolDef,
		withHooks(
			withCwdDefault(readTool as ToolDef, cwd) as ToolDef<
				{ cwd?: string; path: string },
				ReadOutput
			>,
			lookupHook,
			cwd,
			(_, input) => hookEnvForRead(input, cwd),
			onHook,
		) as ToolDef,
		// Write: create/overwrite, replace/delete, insert
		withHooks(
			withCwdDefault(createTool as ToolDef, cwd) as ToolDef<
				{ cwd?: string },
				CreateOutput
			>,
			lookupHook,
			cwd,
			(result) => hookEnvForCreate(result, cwd),
			onHook,
		) as ToolDef,
		withHooks(
			withCwdDefault(replaceTool as ToolDef, cwd) as ToolDef<
				{ cwd?: string },
				ReplaceOutput
			>,
			lookupHook,
			cwd,
			(result) => hookEnvForReplace(result, cwd),
			onHook,
		) as ToolDef,
		withHooks(
			withCwdDefault(insertTool as ToolDef, cwd) as ToolDef<
				{ cwd?: string },
				InsertOutput
			>,
			lookupHook,
			cwd,
			(result) => hookEnvForInsert(result, cwd),
			onHook,
		) as ToolDef,
		// Shell and subagent
		withHooks(
			withCwdDefault(shellTool as ToolDef, cwd) as ToolDef<
				{ cwd?: string; command: string },
				ShellOutput
			>,
			lookupHook,
			cwd,
			(result, input) => hookEnvForShell(result, input, cwd),
			onHook,
		) as ToolDef,
		createSubagentTool(async (prompt, agentName) => {
			if (depth >= MAX_SUBAGENT_DEPTH) {
				throw new Error(
					`Subagent depth limit reached (max ${MAX_SUBAGENT_DEPTH}). ` +
						`Cannot spawn another subagent from depth ${depth}.`,
				);
			}
			return opts.runSubagent(prompt, depth + 1, agentName);
		}, opts.availableAgents) as ToolDef,
	];
}

// Plan mode: read-only tools only, no hooks (hooks are a write-tool concern).
export function buildReadOnlyToolSet(opts: { cwd: string }): ToolDef[] {
	const { cwd } = opts;
	return [
		withCwdDefault(globTool as ToolDef, cwd),
		withCwdDefault(grepTool as ToolDef, cwd),
		withCwdDefault(readTool as ToolDef, cwd),
	];
}
