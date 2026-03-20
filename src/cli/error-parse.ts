import {
  APICallError,
  LoadAPIKeyError,
  NoContentGeneratedError,
  NoSuchModelError,
  RetryError,
} from "ai";
import { extractObjectMessage } from "../llm-api/error-utils.ts";

function safeStringifyErrorObject(value: object): string {
  try {
    const json = JSON.stringify(value);
    if (!json || json === "{}") {
      return "Unknown error";
    }
    const maxLen = 240;
    return json.length > maxLen ? `${json.slice(0, maxLen - 1)}…` : json;
  } catch {
    return "Unknown error";
  }
}

function toUserErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    const msg = err.message.trim();
    if (msg) return msg;
  }

  if (typeof err === "string") {
    const msg = err.trim();
    if (msg) return msg;
  }

  if (
    typeof err === "number" ||
    typeof err === "boolean" ||
    typeof err === "bigint"
  ) {
    return String(err);
  }

  if (typeof err === "object" && err !== null) {
    const objectMessage = extractObjectMessage(err);
    if (objectMessage) return objectMessage;
    return safeStringifyErrorObject(err);
  }

  return "Unknown error";
}

export function parseAppError(err: unknown): {
  headline: string;
  hint?: string;
} {
  if (typeof err === "string") {
    return { headline: err };
  }

  if (err instanceof RetryError) {
    const inner = parseAppError(err.lastError);
    return {
      headline: `Retries exhausted: ${inner.headline}`,
      ...(inner.hint ? { hint: inner.hint } : {}),
    };
  }

  if (err instanceof APICallError) {
    const body = String(err.message).toLowerCase();
    if (
      body.includes("context_length_exceeded") ||
      body.includes("maximum context length") ||
      body.includes("too many tokens") ||
      body.includes("request too large")
    ) {
      return {
        headline: "Max context size reached",
        hint: "Use /new to start a fresh session",
      };
    }
    if (err.statusCode === 429) {
      return {
        headline: "Rate limit hit",
        hint: "Wait a moment and retry, or switch model with /model",
      };
    }
    if (err.statusCode === 401 || err.statusCode === 403) {
      return {
        headline: "Auth failed",
        hint: "Check the relevant provider API key env var",
      };
    }
    return {
      headline: `API error ${err.statusCode ?? "unknown"}`,
      ...(err.url ? { hint: err.url } : {}),
    };
  }

  if (err instanceof NoContentGeneratedError) {
    return {
      headline: "Model returned empty response",
      hint: "Try rephrasing or switching model with /model",
    };
  }

  if (err instanceof LoadAPIKeyError) {
    return {
      headline: "API key not found",
      hint: "Set the relevant provider env var",
    };
  }

  if (err instanceof NoSuchModelError) {
    return {
      headline: "Model not found",
      hint: "Use /model to pick a valid model",
    };
  }

  const isObj = typeof err === "object" && err !== null;
  const code = isObj && "code" in err ? String(err.code) : undefined;
  const message = toUserErrorMessage(err);

  if (code === "ECONNREFUSED" || message.includes("ECONNREFUSED")) {
    return {
      headline: "Connection failed",
      hint: "Check network or local server",
    };
  }

  if (
    code === "ECONNRESET" ||
    message.includes("ECONNRESET") ||
    message.includes("socket connection was closed unexpectedly")
  ) {
    return {
      headline: "Connection lost",
      hint: "The server closed the connection — retry or switch model with /model",
    };
  }

  const firstLine = message.split("\n")[0]?.trim() || "Unknown error";
  return { headline: firstLine };
}
