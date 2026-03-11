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

export function getPreferredModel(): string | null {
	return getSetting("preferred_model");
}

export function setPreferredModel(model: string): void {
	setSetting("preferred_model", model);
}

import type { ThinkingEffort } from "../../llm-api/providers.ts";

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
