import type { ToolDef } from "../llm-api/types.ts";
import type { CreateToolOutput } from "../tools/create.ts";
import { createTool } from "../tools/create.ts";
import { webContentTool, webSearchTool } from "../tools/exa.ts";
import {
	createHookCache,
	hookEnvForCreate,
	hookEnvForRead,
	hookEnvForShell,
	runHook,
} from "../tools/hooks.ts";
import type { ReadOutput } from "../tools/read.ts";
import { readTool } from "../tools/read.ts";
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

/**
 * Inject an onOutput streaming callback into the shell tool's input.
 */
function withShellOutput(
	tool: ToolDef,
	onOutput: (chunk: string) => void,
): ToolDef {
	const originalExecute = tool.execute;
	return {
		...tool,
		execute: async (input: unknown) => {
			const patched = {
				...(typeof input === "object" && input !== null ? input : {}),
				onOutput,
			} as Record<string, unknown>;
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
 * render a UI line. onBeforeHook is called just before the hook script runs so the
 * UI can update the spinner label.
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
	onBeforeHook?: (toolName: string, scriptPath: string) => void,
): ToolDef<TInput, TFinalOutput> {
	const originalExecute = tool.execute;
	return {
		...tool,
		execute: async (input: TInput) => {
			const result = await originalExecute(input);
			const hookScript = lookupHook(tool.name);
			if (hookScript) {
				onBeforeHook?.(tool.name, hookScript);
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
const HOOKABLE_TOOLS = ["read", "create", "shell"];

export function buildToolSet(opts: {
	cwd: string;
	runSubagent: (
		prompt: string,
		agentName?: string,
		modelOverride?: string,
	) => Promise<SubagentOutput>;

	onHook: (toolName: string, scriptPath: string, success: boolean) => void;
	onBeforeHook?: (toolName: string, scriptPath: string) => void;
	onShellOutput?: (chunk: string) => void;
	availableAgents: ReadonlyMap<string, { description: string }>;
	snapshotCallback?: (filePath: string) => Promise<void>;
}): ToolDef[] {
	const { cwd, onHook, onBeforeHook, onShellOutput } = opts;

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
			undefined,
			onBeforeHook,
		) as ToolDef,
		withCwdDefault(listSkillsTool as ToolDef, cwd),
		withCwdDefault(readSkillTool as ToolDef, cwd),
		// Write: create/overwrite only. Targeted edits go through shell + mc-edit.
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
			onBeforeHook,
		) as ToolDef,
		// Shell and subagent
		withHooks(
			(onShellOutput
				? withShellOutput(
						withCwdDefault(shellTool as ToolDef, cwd),
						onShellOutput,
					)
				: withCwdDefault(shellTool as ToolDef, cwd)) as ToolDef<
				{ cwd?: string; command: string },
				ShellOutput
			>,
			lookupHook,
			cwd,
			(result, input) => hookEnvForShell(result, input, cwd),
			onHook,
			undefined,
			onBeforeHook,
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
