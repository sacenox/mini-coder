import type { Api, AssistantMessage, ImageContent, Message, Model, TextContent, Tool } from "@earendil-works/pi-ai";
import { dim } from "./styles.ts";

/** ~1 token per 4 characters, the heuristic pi-ai uses. */
function estimateText(text: string): number {
  return Math.ceil(text.length / 4);
}

function contentChars(content: string | Array<TextContent | ImageContent>): number {
  if (typeof content === "string") return content.length;
  let chars = 0;
  for (const block of content) if (block.type === "text") chars += block.text.length;
  return chars;
}

/** Characters one message contributes. Image and thinking blocks are ignored: an undercount. */
function messageChars(message: Message): number {
  if (message.role === "system") return contentChars(message.content);
  if (message.role === "user") return contentChars(message.content);
  if (message.role === "toolResult") return contentChars(message.content);
  let chars = 0;
  for (const block of message.content) {
    if (block.type === "text") chars += block.text.length;
    else if (block.type === "toolCall") chars += block.name.length + JSON.stringify(block.arguments).length;
  }
  return chars;
}

/**
 * Rough token count for the context the next request would send, used only for
 * display. Anchors on the last provider-reported usage — `totalTokens - output`
 * is the input side of that request — and estimates the messages at and after
 * it; without a usable anchor, estimates system prompt, tools and messages.
 * Anchors with `totalTokens === 0` (aborted or errored) are skipped.
 */
export function estimateContextTokens(messages: Message[], systemPrompt: string, tools: Tool[]): number {
  let anchor: AssistantMessage | undefined;
  let anchorIndex = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.role === "assistant" && message.usage.totalTokens > 0) {
      anchor = message;
      anchorIndex = i;
      break;
    }
  }
  if (anchor !== undefined) {
    let tail = 0;
    for (let i = anchorIndex; i < messages.length; i++) tail += messageChars(messages[i]);
    return anchor.usage.totalTokens - anchor.usage.output + Math.ceil(tail / 4);
  }
  let total = estimateText(systemPrompt) + estimateText(JSON.stringify(tools));
  for (const message of messages) total += Math.ceil(messageChars(message) / 4);
  return total;
}

/** `812`, `12.3k`, `1.24M` — trailing zeros trimmed. */
export function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  const scaled = n < 1_000_000 ? n / 1000 : n / 1_000_000;
  const unit = n < 1_000_000 ? "k" : "M";
  return `${scaled.toFixed(unit === "k" ? 1 : 2).replace(/\.?0+$/, "")}${unit}`;
}

/**
 * The context row: dim, SGR 33 as the window nears, SGR 31 once the next
 * request could not carry a maximum-size reply.
 */
export function contextUsageLine(used: number, model: Model<Api>): string {
  const percent = (used / model.contextWindow) * 100;
  const sizes = `${formatTokens(used)}/${formatTokens(model.contextWindow)}`;
  if (used + model.maxTokens > model.contextWindow) return `\x1b[31mctx full · ${sizes}\x1b[39m`;
  const text = `ctx ${sizes} · ${Math.round(percent)}%`;
  return percent >= 85 ? `\x1b[33m${text}\x1b[39m` : dim(text);
}
