/**
 * Status-bar formatting and rendering for the terminal UI.
 *
 * Computes the cumulative usage pill, abbreviates the working directory, and
 * estimates current model-visible context usage from persisted conversation
 * history.
 *
 * @module
 */

import { homedir } from "node:os";
import { Spacer } from "@cel-tui/components";
import { HStack, Text, visibleWidth } from "@cel-tui/core";
import type { Node } from "@cel-tui/types";
import type { AssistantMessage, Message } from "@mariozechner/pi-ai";
import type { AppState } from "../index.ts";
import { filterModelMessages, getAssistantUsage } from "../session.ts";
import type { StatusTone, Theme } from "../theme.ts";

/** Conservative fixed estimate for an image block's token footprint. */
const ESTIMATED_IMAGE_TOKENS = 1_200;

/**
 * Abbreviate a path with `~` for the home directory.
 *
 * @param path - Absolute path to abbreviate.
 * @returns The abbreviated display path.
 */
export function abbreviatePath(path: string): string {
  const home = homedir();
  if (path === home) {
    return "~";
  }
  if (path.startsWith(`${home}/`)) {
    return `~${path.slice(home.length)}`;
  }
  return path;
}

/** Format a token count with human-friendly units (1.2k, 45k, 1.2M). */
function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

/** Format a token capacity, trimming unnecessary trailing `.0`. */
function formatTokenCapacity(n: number): string {
  return formatTokens(n).replace(/\.0([kM])$/, "$1");
}

/** Format a dollar cost. */
function formatCost(cost: number): string {
  return `$${cost.toFixed(2)}`;
}

/** Format the effort level for display. */
function formatEffort(effort: string): string {
  const map: Record<string, string> = {
    minimal: "min",
    low: "low",
    medium: "med",
    high: "high",
    xhigh: "xhigh",
  };
  return map[effort] ?? effort;
}

/** Format git status for the status bar right side. */
function formatGitStatus(state: AppState): string {
  if (!state.git) return "";
  const parts: string[] = [state.git.branch];
  if (state.git.staged > 0) parts.push(`+${state.git.staged}`);
  if (state.git.modified > 0) parts.push(`~${state.git.modified}`);
  if (state.git.untracked > 0) parts.push(`?${state.git.untracked}`);
  if (state.git.ahead > 0) parts.push(`▲ ${state.git.ahead}`);
  if (state.git.behind > 0) parts.push(`▼ ${state.git.behind}`);
  return parts.join(" ");
}

/** Format model info for the status bar left side. */
function formatModelInfo(state: AppState): string {
  if (!state.model) return "no model";
  return `${state.model.provider}/${state.model.id} · ${formatEffort(state.effort)}`;
}

/** Calculate context tokens from assistant usage, falling back when `totalTokens` is zero. */
function calculateUsageTokens(usage: AssistantMessage["usage"]): number {
  return (
    usage.totalTokens ||
    usage.input + usage.output + usage.cacheRead + usage.cacheWrite
  );
}

/** Estimate token usage from a character count using a conservative chars/4 heuristic. */
function estimateCharacterTokens(charCount: number): number {
  return Math.ceil(charCount / 4);
}

type UserMultipartContent = Exclude<
  Extract<Message, { role: "user" }>["content"],
  string
>;
type TextOrImageContentBlock =
  | UserMultipartContent[number]
  | Extract<Message, { role: "toolResult" }>["content"][number];

function estimateTextOrImageContentTokens(
  content: readonly TextOrImageContentBlock[],
): number {
  let chars = 0;
  let imageTokens = 0;

  for (const block of content) {
    if (block.type === "text") {
      chars += block.text.length;
      continue;
    }
    if (block.type === "image") {
      imageTokens += ESTIMATED_IMAGE_TOKENS;
    }
  }

  return estimateCharacterTokens(chars) + imageTokens;
}

function estimateUserMessageTokens(
  message: Extract<Message, { role: "user" }>,
): number {
  if (typeof message.content === "string") {
    return estimateCharacterTokens(message.content.length);
  }
  return estimateTextOrImageContentTokens(message.content);
}

function estimateAssistantBlockCharacters(
  block: Extract<Message, { role: "assistant" }>["content"][number],
): number {
  if (block.type === "text") {
    return block.text.length;
  }
  if (block.type === "thinking") {
    return block.thinking.length;
  }
  return block.name.length + JSON.stringify(block.arguments).length;
}

function estimateAssistantMessageTokens(
  message: Extract<Message, { role: "assistant" }>,
): number {
  const chars = message.content.reduce((total, block) => {
    return total + estimateAssistantBlockCharacters(block);
  }, 0);
  return estimateCharacterTokens(chars);
}

function estimateToolResultMessageTokens(
  message: Extract<Message, { role: "toolResult" }>,
): number {
  return estimateTextOrImageContentTokens(message.content);
}

/** Estimate token usage for a model-visible message. */
function estimateMessageTokens(message: Message): number {
  switch (message.role) {
    case "user":
      return estimateUserMessageTokens(message);
    case "assistant":
      return estimateAssistantMessageTokens(message);
    case "toolResult":
      return estimateToolResultMessageTokens(message);
  }
}

/** Find the latest assistant usage that can anchor context estimation. */
function getLatestValidAssistantUsage(
  messages: readonly Message[],
): { index: number; tokens: number } | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (
      message?.role === "assistant" &&
      message.stopReason !== "aborted" &&
      message.stopReason !== "error"
    ) {
      const usage = getAssistantUsage(message);
      if (!usage) {
        continue;
      }
      return {
        index: i,
        tokens: calculateUsageTokens(usage),
      };
    }
  }
  return null;
}

/** Estimate the current model-visible context size for the next request. */
function estimateCurrentContextTokens(state: AppState): number {
  const messages = filterModelMessages(state.messages);
  const latestUsage = getLatestValidAssistantUsage(messages);

  if (!latestUsage) {
    return messages.reduce((total, message) => {
      return total + estimateMessageTokens(message);
    }, 0);
  }

  let total = latestUsage.tokens;
  for (let i = latestUsage.index + 1; i < messages.length; i++) {
    total += estimateMessageTokens(messages[i]!);
  }
  return total;
}

/** Estimate current context usage as a percentage of the active model window. */
function getContextPercentage(state: AppState): number {
  if (!state.model || state.model.contextWindow <= 0) {
    return 0;
  }
  const contextTokens = estimateCurrentContextTokens(state);
  return (contextTokens / state.model.contextWindow) * 100;
}

/** Format cumulative session totals plus estimated current context usage for the status bar. */
function formatUsage(state: AppState, contextPct: number): string {
  if (!state.model) return "";
  const input = formatTokens(state.stats.totalInput);
  const output = formatTokens(state.stats.totalOutput);
  const contextWindow = formatTokenCapacity(state.model.contextWindow);
  return `in:${input} out:${output} · ${contextPct.toFixed(1)}%/${contextWindow} · ${formatCost(state.stats.totalCost)}`;
}

/** Select the model/effort pill tone for the current reasoning effort. */
function getEffortTone(theme: Theme, effort: string): StatusTone {
  switch (effort) {
    case "xhigh":
      return theme.statusEffortScale[3];
    case "high":
      return theme.statusEffortScale[2];
    case "medium":
      return theme.statusEffortScale[1];
    default:
      return theme.statusEffortScale[0];
  }
}

/** Select the usage/context pill tone for the current context pressure. */
function getContextTone(theme: Theme, contextPct: number): StatusTone {
  if (contextPct >= 90) {
    return theme.statusContextScale[4];
  }
  if (contextPct >= 75) {
    return theme.statusContextScale[3];
  }
  if (contextPct >= 50) {
    return theme.statusContextScale[2];
  }
  if (contextPct >= 25) {
    return theme.statusContextScale[1];
  }
  return theme.statusContextScale[0];
}

/** Render a single compact status pill. */
function renderStatusPill(text: string, tone: StatusTone): Node {
  return HStack({ bgColor: tone.bg, padding: { x: 1 } }, [
    Text(text, { fgColor: tone.fg }),
  ]);
}

function measureStatusPill(text: string): number {
  return visibleWidth(text) + 2;
}

function leftTruncate(text: string, maxWidth: number): string {
  if (maxWidth <= 0) {
    return "";
  }
  if (visibleWidth(text) <= maxWidth) {
    return text;
  }
  if (maxWidth === 1) {
    return "…";
  }

  for (let i = text.lastIndexOf("/"); i > 0; i = text.lastIndexOf("/", i - 1)) {
    const candidate = text.slice(i);
    if (visibleWidth(candidate) <= maxWidth - 1) {
      return `…${candidate}`;
    }
  }

  let suffix = "";
  for (const char of Array.from(text).reverse()) {
    const next = `${char}${suffix}`;
    if (visibleWidth(next) > maxWidth - 1) {
      break;
    }
    suffix = next;
  }

  return `…${suffix}`;
}

/**
 * Render the one-line status bar as compact padded pills.
 *
 * The inner pills use the neutral secondary tone. The model pill uses a
 * reasoning-effort tone scale, and the usage pill uses an independent
 * context-pressure tone scale. The git pill is omitted outside repositories.
 *
 * @param state - Application state.
 * @param cols - Current terminal width in columns.
 * @returns The rendered status bar node.
 */
export function renderStatusBar(
  state: AppState,
  cols = Number.POSITIVE_INFINITY,
): Node {
  const fullCwd = abbreviatePath(state.cwd);
  const gitStatus = formatGitStatus(state);
  const modelInfo = formatModelInfo(state);
  const contextPct = getContextPercentage(state);
  const usage = formatUsage(state, contextPct);
  const reservedWidth =
    2 +
    measureStatusPill(modelInfo) +
    measureStatusPill(usage) +
    (gitStatus ? measureStatusPill(gitStatus) : 0) +
    2;
  const cwd = Number.isFinite(cols)
    ? leftTruncate(fullCwd, Math.max(Math.floor(cols) - reservedWidth, 1))
    : fullCwd;

  const secondaryTone = state.theme.statusSecondary;
  const children: Node[] = [
    renderStatusPill(modelInfo, getEffortTone(state.theme, state.effort)),
    renderStatusPill(cwd, secondaryTone),
    Spacer(),
  ];
  if (gitStatus) {
    children.push(renderStatusPill(gitStatus, secondaryTone));
  }
  children.push(
    renderStatusPill(usage, getContextTone(state.theme, contextPct)),
  );

  return HStack(
    {
      height: 1,
      padding: { x: 1 },
    },
    children,
  );
}
