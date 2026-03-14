import type { ToolDef } from "../llm-api/types.ts";
import type { CreateToolOutput } from "../tools/create.ts";
import { createTool } from "../tools/create.ts";
import { webContentTool, webSearchTool } from "../tools/exa.ts";
import {
	createHookCache,
	hookEnvForCreate,
	hookEnvForInsert,
	hookEnvForRead,
	hookEnvForReplace,
	hookEnvForShell,
	runHook,
} from "../tools/hooks.ts";
import type { InsertToolOutput } from "../tools/insert.ts";
import { insertTool } from "../tools/insert.ts";
import type { ReadOutput } from "../tools/read.ts";
import { readTool } from "../tools/read.ts";
import type { ReplaceToolOutput } from "../tools/replace.ts";
import { replaceTool } from "../tools/replace.ts";
import type { ShellOutput } from "../tools/shell.ts";
import { shellTool } from "../tools/shell.ts";
import { listSkillsTool, readSkillTool } from "../tools/skills.ts";
import { createSubagentTool, type SubagentOutput } from "../tools/subagent.ts";
import {
	finalizeWriteResult,
	stripWriteResultMeta,
	type WriteResultMeta,
} from "../tools/write-result.ts";

// ─── Tool wrappers ────────────────────────────────────────────────────────────

/**
 * Inject a default cwd if not provided by the LLM.
 */
function withCwdDefault(
	tool: ToolDef,
	cwd: string,
	snapshotCallback?: (filePath: string) => Promise<void>,
): ToolDef {
	const originalExecute = tool.execute;
	return {
		...tool,
		execute: async (input: unknown) => {
			// Mutate defaults onto the existing input object instead of
			// allocating a new spread object on every tool invocation.
			const patched = (
				typeof input === "object" && input !== null ? input : {}
			) as Record<string, unknown>;
			if (patched.cwd === undefined) patched.cwd = cwd;
			if (snapshotCallback && patched.snapshotCallback === undefined)
				patched.snapshotCallback = snapshotCallback;
			return originalExecute(patched);
		},
	};
}

type EnvBuilder<TInput, TOutput> = (
	result: TOutput,
	input: TInput,
) => Record<string, string>;

type ResultFinalizer<TOutput, TFinalOutput> = (
	result: TOutput,
) => Promise<TFinalOutput>;

/**
 * Wrap a tool to fire its post-hook (if one exists) after each successful execute.
 * Hooks are looked up via the session-scoped cache — no filesystem access per call.
 * Errors are always swallowed. onHook is called with the result so the caller can
 * render a UI line.
 */
function withHooks<
	TInput extends { cwd?: string },
	TOutput,
	TFinalOutput = TOutput,
>(
	tool: ToolDef<TInput, TOutput>,
	lookupHook: (toolName: string) => string | null,
	cwd: string,
	buildEnv: EnvBuilder<TInput, TOutput>,
	onHook: (toolName: string, scriptPath: string, success: boolean) => void,
	finalizeResult?: ResultFinalizer<TOutput, TFinalOutput>,
): ToolDef<TInput, TFinalOutput> {
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
				if (finalizeResult) return finalizeResult(result);
				return result as TFinalOutput;
			}
			if (finalizeResult) {
				return stripWriteResultMeta(
					result as TOutput & WriteResultMeta & { path: string },
				) as TFinalOutput;
			}
			return result as TFinalOutput;
		},
	};
}

// ─── Tool registry ────────────────────────────────────────────────────────────

// Names of all local tools that support hooks (MCP tools are excluded).
const HOOKABLE_TOOLS = ["read", "create", "replace", "insert", "shell"];

export function buildToolSet(opts: {
	cwd: string;
	runSubagent: (
		prompt: string,
		agentName?: string,
		modelOverride?: string,
	) => Promise<SubagentOutput>;

	onHook: (toolName: string, scriptPath: string, success: boolean) => void;
	availableAgents: ReadonlyMap<string, { description: string }>;
	snapshotCallback?: (filePath: string) => Promise<void>;
}): ToolDef[] {
	const { cwd, onHook } = opts;
	const lookupHook = createHookCache(HOOKABLE_TOOLS, cwd);

	const tools: ToolDef[] = [
		// Read-only: discover and inspect files
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
		withCwdDefault(listSkillsTool as ToolDef, cwd),
		withCwdDefault(readSkillTool as ToolDef, cwd),
		// Write: create/overwrite, replace/delete, insert
		withHooks(
			withCwdDefault(
				createTool as ToolDef,
				cwd,
				opts.snapshotCallback,
			) as ToolDef<{ cwd?: string }, CreateToolOutput>,
			lookupHook,
			cwd,
			(result) => hookEnvForCreate(result, cwd),
			onHook,
			finalizeWriteResult,
		) as ToolDef,
		withHooks(
			withCwdDefault(
				replaceTool as ToolDef,
				cwd,
				opts.snapshotCallback,
			) as ToolDef<{ cwd?: string }, ReplaceToolOutput>,
			lookupHook,
			cwd,
			(result) => hookEnvForReplace(result, cwd),
			onHook,
			finalizeWriteResult,
		) as ToolDef,
		withHooks(
			withCwdDefault(
				insertTool as ToolDef,
				cwd,
				opts.snapshotCallback,
			) as ToolDef<{ cwd?: string }, InsertToolOutput>,
			lookupHook,
			cwd,
			(result) => hookEnvForInsert(result, cwd),
			onHook,
			finalizeWriteResult,
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
			const output = await opts.runSubagent(prompt, agentName, undefined);
			return output;
		}, opts.availableAgents) as ToolDef,
	];

	if (process.env.EXA_API_KEY) {
		tools.push(webSearchTool as ToolDef, webContentTool as ToolDef);
	}

	return tools;
}
