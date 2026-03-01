import {
	APICallError,
	LoadAPIKeyError,
	NoContentGeneratedError,
	NoSuchModelError,
	RetryError,
} from "ai";

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
	const message = isObj && "message" in err ? String(err.message) : String(err);

	if (code === "ECONNREFUSED" || message.includes("ECONNREFUSED")) {
		return {
			headline: "Connection failed",
			hint: "Check network or local server",
		};
	}

	const firstLine = message.split("\n")[0]?.trim() || "Unknown error";
	return { headline: firstLine };
}
