import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadAgents } from "../cli/agents.ts";
import { formatSubagentLabel } from "../cli/output.ts";
import { resolveModel } from "../llm-api/providers.ts";
import { type CoreMessage, runTurn } from "../llm-api/turn.ts";
import type { SubagentOutput } from "../tools/subagent.ts";
import {
	MergeInProgressError,
	cleanupBranch,
	createWorktree,
	initializeWorktree,
	isGitRepo,
	mergeWorktree,
	removeWorktree,
	syncDirtyStateToWorktree,
} from "../tools/worktree.ts";
import type { AgentReporter } from "./reporter.ts";
import { buildSystemPrompt } from "./system-prompt.ts";
import { buildToolSet } from "./tools.ts";

import type { ThinkingEffort } from "../llm-api/providers.ts";

function makeWorktreeBranch(laneId: number): string {
	return `mc-sub-${laneId}-${Date.now()}`;
}

function makeWorktreePath(laneId: number): string {
	const suffix = crypto.randomUUID().replace(/-/g, "").slice(0, 10);
	return join(tmpdir(), `mc-wt-${laneId}-${suffix}`);
}

export function createSubagentRunner(
	cwd: string,
	reporter: AgentReporter,
	getCurrentModel: () => string,
	getThinkingEffort: () => ThinkingEffort | null,
) {
	let nextLaneId = 1;
	const activeLanes = new Set<number>();
	const worktreesEnabledPromise = isGitRepo(cwd);

	let mergeLock: Promise<void> = Promise.resolve();
	const withMergeLock = <T>(fn: () => Promise<T>): Promise<T> => {
		const task = mergeLock.then(fn, fn);
		mergeLock = task.then(
			() => undefined,
			() => undefined,
		);
		return task;
	};

	const runSubagent = async (
		prompt: string,
		depth = 0,
		agentName?: string,
		modelOverride?: string,
		parentLabel?: string,
	): Promise<SubagentOutput> => {
		const laneId = nextLaneId++;
		activeLanes.add(laneId);

		let subagentCwd = cwd;
		let worktreeBranch: string | undefined;
		let worktreePath: string | undefined;
		let preserveBranchOnFailure = false;

		try {
			const worktreesEnabled = await worktreesEnabledPromise;
			if (worktreesEnabled) {
				const nextBranch = makeWorktreeBranch(laneId);
				const nextPath = makeWorktreePath(laneId);
				await createWorktree(cwd, nextBranch, nextPath);
				worktreeBranch = nextBranch;
				worktreePath = nextPath;
				await syncDirtyStateToWorktree(cwd, nextPath);
				await initializeWorktree(cwd, nextPath);
				subagentCwd = nextPath;
			}

			const currentModel = getCurrentModel();
			const allAgents = loadAgents(subagentCwd);
			const agentConfig = agentName ? allAgents.get(agentName) : undefined;
			if (agentName && !agentConfig) {
				throw new Error(
					`Unknown agent "${agentName}". Available agents: ${[...allAgents.keys()].join(", ") || "(none)"}`,
				);
			}

			const model = modelOverride ?? agentConfig?.model ?? currentModel;
			const systemPrompt =
				agentConfig?.systemPrompt ?? buildSystemPrompt(subagentCwd, model);

			const subMessages: CoreMessage[] = [{ role: "user", content: prompt }];
			const laneLabel = formatSubagentLabel(laneId, parentLabel);

			const subTools = buildToolSet({
				cwd: subagentCwd,
				depth,
				runSubagent,
				onHook: (tool, path, ok) => reporter.renderHook(tool, path, ok),
				availableAgents: allAgents,
				parentLabel: laneLabel,
			}).filter((tool) => tool.name !== "subagent");

			const subLlm = resolveModel(model);

			let result = "";
			let inputTokens = 0;
			let outputTokens = 0;

			const effort = getThinkingEffort();
			const events = runTurn({
				model: subLlm,
				modelString: model,
				messages: subMessages,
				tools: subTools,
				systemPrompt,
				...(effort ? { thinkingEffort: effort } : {}),
			});

			for await (const event of events) {
				reporter.stopSpinner();
				reporter.renderSubagentEvent(event, {
					laneId,
					...(parentLabel ? { parentLabel } : {}),
					...(worktreeBranch ? { worktreeBranch } : {}),
					activeLanes,
				});
				reporter.startSpinner("thinking");
				if (event.type === "text-delta") result += event.delta;
				if (event.type === "turn-complete") {
					inputTokens = event.inputTokens;
					outputTokens = event.outputTokens;
				}
			}

			const baseOutput: SubagentOutput = { result, inputTokens, outputTokens };
			const branch = worktreeBranch;
			const path = worktreePath;
			if (!branch || !path) return baseOutput;

			preserveBranchOnFailure = true;
			return await withMergeLock(async () => {
				try {
					const mergeResult = await mergeWorktree(cwd, branch);
					await removeWorktree(cwd, path);
					if (mergeResult.success) {
						await cleanupBranch(cwd, branch);
						return baseOutput;
					}
					return {
						...baseOutput,
						mergeConflict: {
							branch,
							conflictFiles: mergeResult.conflictFiles,
						},
					};
				} catch (error) {
					if (error instanceof MergeInProgressError) {
						await removeWorktree(cwd, path);
						return {
							...baseOutput,
							mergeBlocked: {
								branch,
								conflictFiles: error.conflictFiles,
							},
						};
					}
					throw error;
				}
			});
		} catch (error) {
			if (worktreeBranch && worktreePath) {
				const branch = worktreeBranch;
				const path = worktreePath;
				try {
					await withMergeLock(async () => {
						await removeWorktree(cwd, path);
						if (!preserveBranchOnFailure) {
							await cleanupBranch(cwd, branch);
						}
					});
				} catch {
					// Preserve the original subagent failure.
				}
			}
			throw error;
		} finally {
			activeLanes.delete(laneId);
		}
	};

	return runSubagent;
}
