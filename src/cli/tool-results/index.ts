import {
	renderCreateResult,
	renderReplaceOrInsertResult,
} from "./file-edits.ts";
import { renderMcpResult } from "./mcp.ts";
import { renderReadResult } from "./read.ts";
import { renderShellResult } from "./shell.ts";
import { renderReadSkillResult } from "./skills.ts";
import { renderSubagentResult } from "./subagent.ts";
import type { ToolResultRenderer } from "./types.ts";
import { renderWebContentResult, renderWebSearchResult } from "./web.ts";

const TOOL_RESULT_RENDERERS: Readonly<Record<string, ToolResultRenderer>> = {
	read: renderReadResult,
	create: renderCreateResult,
	replace: (result) => renderReplaceOrInsertResult("replace", result),
	insert: (result) => renderReplaceOrInsertResult("insert", result),
	shell: renderShellResult,
	subagent: renderSubagentResult,
	readSkill: renderReadSkillResult,
	webSearch: renderWebSearchResult,
	webContent: renderWebContentResult,
};

export function renderToolResultByName(
	toolName: string,
	result: unknown,
): boolean {
	if (toolName.startsWith("mcp_")) {
		return renderMcpResult(result);
	}

	const renderer = TOOL_RESULT_RENDERERS[toolName];
	if (!renderer) return false;
	return renderer(result, toolName);
}
