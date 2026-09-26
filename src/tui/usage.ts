import type { Api, Message, Model, Tool } from "@earendil-works/pi-ai";
import { estimateContextTokens as estimate, estimateTextTokens } from "@earendil-works/pi-ai/utils/estimate";
import { dim, red, yellow } from "./styles.ts";

/**
 * Rough token count for the context the next request would send, used only for
 * display. Delegates to `pi-ai`'s estimator, which anchors on the last
 * provider-reported usage and estimates the messages after it. Before any usage
 * exists there is no anchor, so the system prompt and tools are added explicitly.
 */
export function estimateContextTokens(messages: Message[], systemPrompt: string, tools: Tool[]): number {
  const tokens = estimate(messages);
  if (tokens.lastUsageIndex !== null) return tokens.tokens;
  return tokens.tokens + estimateTextTokens(systemPrompt) + estimateTextTokens(JSON.stringify(tools));
}

/** `812`, `12.3k`, `1.24M` — trailing zeros trimmed. */
function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  const scaled = n < 1_000_000 ? n / 1000 : n / 1_000_000;
  const unit = n < 1_000_000 ? "k" : "M";
  return `${scaled.toFixed(unit === "k" ? 1 : 2).replace(/\.?0+$/, "")}${unit}`;
}

/**
 * The context row: dim, yellow as the window nears, red once the next request
 * could not carry a maximum-size reply.
 */
export function contextUsageLine(used: number, model: Model<Api>): string {
  const percent = (used / model.contextWindow) * 100;
  const sizes = `${formatTokens(used)}/${formatTokens(model.contextWindow)}`;
  if (used + model.maxTokens > model.contextWindow) return red(`ctx full · ${sizes}`);
  const text = `ctx ${sizes} · ${Math.round(percent)}%`;
  return percent >= 85 ? yellow(text) : dim(text);
}
