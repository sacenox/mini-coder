import { homedir } from "node:os";
import { join } from "node:path";
import type { Message } from "@earendil-works/pi-ai";
import { parseDocument } from "yaml";

// Mixed bag of helpers that can be shared across the codebase

export const DATA_DIR =
  Bun.env.MINI_CODER_DATA_DIR ?? join(homedir(), ".config", "mini-coder");
export const SESSIONS_DIR = join(DATA_DIR, "sessions");
export const AUTH_PATH = join(DATA_DIR, "auth.json");
export const SETTINGS_PATH = join(DATA_DIR, "settings.json");

export function secureRandomString(
  length: number,
  chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789",
): string {
  const result: string[] = [];
  const charsLength = chars.length;
  const maxValid = Math.floor(256 / charsLength) * charsLength;
  const randomBytes = new Uint8Array(length * 2);

  while (result.length < length) {
    crypto.getRandomValues(randomBytes);

    for (const byte of randomBytes) {
      if (byte < maxValid) {
        result.push(chars[byte % charsLength]);
        if (result.length === length) break;
      }
    }
  }

  return result.join("");
}

export function elapsedTime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;

  const weeks = Math.floor(days / 7);
  if (weeks < 4) return `${weeks}w`;

  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo`;

  const years = Math.floor(days / 365);
  return `${years}y`;
}

export function relativeTime(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  return elapsedTime(seconds);
}

export function onceEvery<T extends unknown[]>(
  n: number,
  fn: (...args: T) => void,
) {
  let calls = 0;

  return (...args: T) => {
    calls++;

    if (calls % n === 0) {
      fn(...args);
    }
  };
}

export function takeTail<T>(arr: T[], x: number): T[] {
  return x <= 0 ? [] : arr.slice(-x);
}

const MAX_CONTEXT_SAFETY_TOKENS = 4_096;
const CONTEXT_SAFETY_RATIO = 0.05;

type ReportedUsage = {
  contextTokens: number;
  outputTokens: number;
};

function reportedUsage(message: Message): ReportedUsage | undefined {
  if (message.role !== "assistant" || !message.usage) return;
  if (message.stopReason === "aborted" || message.stopReason === "error")
    return;

  const { usage } = message;
  const calculated =
    usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
  const contextTokens =
    Number.isFinite(usage.totalTokens) && usage.totalTokens > 0
      ? usage.totalTokens
      : calculated;
  if (!Number.isFinite(contextTokens) || contextTokens <= 0) return;

  const outputTokens = Number.isFinite(usage.output)
    ? Math.max(0, Math.ceil(usage.output))
    : 0;

  return {
    contextTokens: Math.ceil(contextTokens),
    outputTokens,
  };
}

function latestReportedUsage(
  messages: readonly Message[],
): (ReportedUsage & { index: number }) | undefined {
  for (let index = messages.length - 1; index >= 0; index--) {
    const usage = reportedUsage(messages[index]);
    if (usage) return { ...usage, index };
  }
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function estimateContextTokens(
  messages: readonly Message[],
  fallbackSerializedContext = JSON.stringify(messages),
): number {
  const usage = latestReportedUsage(messages);
  if (!usage) return estimateTokens(fallbackSerializedContext);

  const trailingMessages = messages.slice(usage.index + 1);
  if (trailingMessages.length === 0) return usage.contextTokens;

  return usage.contextTokens + estimateTokens(JSON.stringify(trailingMessages));
}

export function estimateNextTurnTokens(
  messages: readonly Message[],
  maxTokens: number,
): number {
  const usage = latestReportedUsage(messages);
  if (!usage) return 0;

  return Math.min(usage.outputTokens, Math.max(0, maxTokens));
}

export function contextCompactionThreshold(
  contextWindow: number,
  estimatedNextTurnTokens: number,
): number {
  const safetyTokens = Math.min(
    MAX_CONTEXT_SAFETY_TOKENS,
    Math.floor(Math.max(0, contextWindow) * CONTEXT_SAFETY_RATIO),
  );

  return Math.max(0, contextWindow - estimatedNextTurnTokens - safetyTokens);
}

export function parseSkillFrontmatter(content: string) {
  const match = /^---\s*\n([\s\S]*?)\n---/.exec(content);

  if (!match) {
    return undefined;
  }

  const doc = parseDocument(match[1]);
  const data = doc.toJS() as unknown;

  if (!data || typeof data !== "object") {
    return undefined;
  }

  const record = data as Record<string, unknown>;
  const name = typeof record.name === "string" ? record.name.trim() : "";
  const description =
    typeof record.description === "string" ? record.description.trim() : "";

  if (!name || !description) {
    return undefined;
  }

  return { name, description };
}

export function formatTimestamp(timestampMs: number): string {
  return new Date(timestampMs).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}
