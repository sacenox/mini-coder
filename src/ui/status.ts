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
import type { Theme } from "../theme.ts";

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

/** Estimate token usage for a model-visible message. */
function estimateMessageTokens(message: Message): number {
  switch (message.role) {
    case "user": {
      if (typeof message.content === "string") {
        return estimateCharacterTokens(message.content.length);
      }

      let chars = 0;
      let imageTokens = 0;
      for (const block of message.content) {
        if (block.type === "text") {
          chars += block.text.length;
        } else if (block.type === "image") {
          imageTokens += ESTIMATED_IMAGE_TOKENS;
        }
      }
      return estimateCharacterTokens(chars) + imageTokens;
    }
    case "assistant": {
      let chars = 0;
      for (const block of message.content) {
        if (block.type === "text") {
          chars += block.text.length;
        } else if (block.type === "thinking") {
          chars += block.thinking.length;
        } else if (block.type === "toolCall") {
          chars += block.name.length + JSON.stringify(block.arguments).length;
        }
      }
      return estimateCharacterTokens(chars);
    }
    case "toolResult": {
      let chars = 0;
      let imageTokens = 0;
      for (const block of message.content) {
        if (block.type === "text") {
          chars += block.text.length;
        } else if (block.type === "image") {
          imageTokens += ESTIMATED_IMAGE_TOKENS;
        }
      }
      return estimateCharacterTokens(chars) + imageTokens;
    }
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

/** Format cumulative session totals plus estimated current context usage for the status bar. */
function formatUsage(state: AppState): string {
  if (!state.model) return "";
  const input = formatTokens(state.stats.totalInput);
  const output = formatTokens(state.stats.totalOutput);
  const contextTokens = estimateCurrentContextTokens(state);
  const contextPct =
    state.model.contextWindow > 0
      ? (contextTokens / state.model.contextWindow) * 100
      : 0;
  const contextWindow = formatTokenCapacity(state.model.contextWindow);
  return `in:${input} out:${output} · ${contextPct.toFixed(1)}%/${contextWindow} · ${formatCost(state.stats.totalCost)}`;
}

/** Render a single compact status pill. */
function renderStatusPill(
  text: string,
  bgColor: Theme["statusPrimaryBg"] | Theme["statusSecondaryBg"],
  theme: Theme,
): Node {
  return HStack({ bgColor, padding: { x: 1 } }, [
    Text(text, { fgColor: theme.statusText }),
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
 * Outer pills use the primary background and inner pills use the secondary
 * background. The git pill is omitted outside repositories.
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
  const usage = formatUsage(state);
  const reservedWidth =
    2 +
    measureStatusPill(modelInfo) +
    measureStatusPill(usage) +
    (gitStatus ? measureStatusPill(gitStatus) : 0) +
    2;
  const cwd = Number.isFinite(cols)
    ? leftTruncate(fullCwd, Math.max(Math.floor(cols) - reservedWidth, 1))
    : fullCwd;

  const children: Node[] = [
    renderStatusPill(modelInfo, state.theme.statusPrimaryBg, state.theme),
    renderStatusPill(cwd, state.theme.statusSecondaryBg, state.theme),
    Spacer(),
  ];
  if (gitStatus) {
    children.push(
      renderStatusPill(gitStatus, state.theme.statusSecondaryBg, state.theme),
    );
  }
  children.push(
    renderStatusPill(usage, state.theme.statusPrimaryBg, state.theme),
  );

  return HStack(
    {
      height: 1,
      padding: { x: 1 },
    },
    children,
  );
}
