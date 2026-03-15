import type { ThinkingEffort } from "../../llm-api/providers.ts";
import type { ContextPruningMode } from "../../llm-api/turn.ts";
import { getDb } from "./connection.ts";

function getSetting(key: string): string | null {
	const row = getDb()
		.query<{ value: string }, [string]>(
			"SELECT value FROM settings WHERE key = ?",
		)
		.get(key);
	return row?.value ?? null;
}

function setSetting(key: string, value: string): void {
	getDb().run(
		`INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
		[key, value],
	);
}

export function parseBooleanSetting(
	value: string | null,
	fallback: boolean,
): boolean {
	if (value === null) return fallback;
	const normalized = value.trim().toLowerCase();
	if (normalized === "true" || normalized === "on" || normalized === "1") {
		return true;
	}
	if (normalized === "false" || normalized === "off" || normalized === "0") {
		return false;
	}
	return fallback;
}

export function getPreferredModel(): string | null {
	return getSetting("preferred_model");
}

export function setPreferredModel(model: string): void {
	setSetting("preferred_model", model);
}

export function getPreferredThinkingEffort(): ThinkingEffort | null {
	const v = getSetting("preferred_thinking_effort");
	if (v === "low" || v === "medium" || v === "high" || v === "xhigh") return v;
	return null;
}

export function setPreferredThinkingEffort(
	effort: ThinkingEffort | null,
): void {
	if (effort === null) {
		getDb().run("DELETE FROM settings WHERE key = 'preferred_thinking_effort'");
	} else {
		setSetting("preferred_thinking_effort", effort);
	}
}

export function getPreferredShowReasoning(): boolean {
	return parseBooleanSetting(getSetting("preferred_show_reasoning"), false);
}

export function setPreferredShowReasoning(show: boolean): void {
	setSetting("preferred_show_reasoning", show ? "true" : "false");
}

export function getPreferredVerboseOutput(): boolean {
	return parseBooleanSetting(getSetting("preferred_verbose_output"), false);
}

export function setPreferredVerboseOutput(verbose: boolean): void {
	setSetting("preferred_verbose_output", verbose ? "true" : "false");
}

export function getPreferredContextPruningMode(): ContextPruningMode {
	const v = getSetting("preferred_context_pruning_mode");
	if (v === "off" || v === "balanced" || v === "aggressive") return v;
	return "balanced";
}

export function setPreferredContextPruningMode(mode: ContextPruningMode): void {
	setSetting("preferred_context_pruning_mode", mode);
}

export function getPreferredToolResultPayloadCapBytes(): number {
	const v = getSetting("preferred_tool_result_payload_cap_bytes");
	if (v === null) return 16 * 1024;
	const parsed = Number.parseInt(v, 10);
	if (!Number.isFinite(parsed) || parsed < 0) return 16 * 1024;
	return parsed;
}

export function setPreferredToolResultPayloadCapBytes(bytes: number): void {
	setSetting(
		"preferred_tool_result_payload_cap_bytes",
		String(Math.max(0, bytes)),
	);
}

export function getPreferredActiveAgent(): string | null {
	return getSetting("preferred_active_agent");
}

export function setPreferredActiveAgent(agent: string | null): void {
	if (agent === null) {
		getDb().run("DELETE FROM settings WHERE key = 'preferred_active_agent'");
	} else {
		setSetting("preferred_active_agent", agent);
	}
}
export function getPreferredPromptCachingEnabled(): boolean {
	return parseBooleanSetting(
		getSetting("preferred_prompt_caching_enabled"),
		true,
	);
}

export function setPreferredPromptCachingEnabled(enabled: boolean): void {
	setSetting("preferred_prompt_caching_enabled", enabled ? "true" : "false");
}

export function getPreferredOpenAIPromptCacheRetention(): "in_memory" | "24h" {
	const v = getSetting("preferred_openai_prompt_cache_retention");
	if (v === "24h") return "24h";
	return "in_memory";
}

export function setPreferredOpenAIPromptCacheRetention(
	retention: "in_memory" | "24h",
): void {
	setSetting("preferred_openai_prompt_cache_retention", retention);
}

export function getPreferredGoogleCachedContent(): string | null {
	return getSetting("preferred_google_cached_content");
}

export function setPreferredGoogleCachedContent(
	contentId: string | null,
): void {
	if (contentId === null) {
		getDb().run(
			"DELETE FROM settings WHERE key = 'preferred_google_cached_content'",
		);
	} else {
		setSetting("preferred_google_cached_content", contentId);
	}
}
