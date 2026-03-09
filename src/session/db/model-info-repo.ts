import { getDb } from "./connection.ts";

export interface ModelCapabilityRow {
	canonical_model_id: string;
	context_window: number | null;
	reasoning: number;
	source_provider: string | null;
	raw_json: string | null;
	updated_at: number;
}

export interface ProviderModelRow {
	provider: string;
	provider_model_id: string;
	display_name: string;
	canonical_model_id: string | null;
	context_window: number | null;
	free: number | null;
	updated_at: number;
}

export function listModelCapabilities(): ModelCapabilityRow[] {
	return getDb()
		.query<ModelCapabilityRow, []>(
			"SELECT canonical_model_id, context_window, reasoning, source_provider, raw_json, updated_at FROM model_capabilities",
		)
		.all();
}

export function replaceModelCapabilities(rows: ModelCapabilityRow[]): void {
	const db = getDb();
	const insertStmt = db.prepare(
		`INSERT INTO model_capabilities (
			canonical_model_id,
			context_window,
			reasoning,
			source_provider,
			raw_json,
			updated_at
		) VALUES (?, ?, ?, ?, ?, ?)`,
	);
	const run = db.transaction(() => {
		db.run("DELETE FROM model_capabilities");
		for (const row of rows) {
			insertStmt.run(
				row.canonical_model_id,
				row.context_window,
				row.reasoning,
				row.source_provider,
				row.raw_json,
				row.updated_at,
			);
		}
	});
	run();
}

export function listProviderModels(): ProviderModelRow[] {
	return getDb()
		.query<ProviderModelRow, []>(
			"SELECT provider, provider_model_id, display_name, canonical_model_id, context_window, free, updated_at FROM provider_models ORDER BY provider ASC, display_name ASC",
		)
		.all();
}

export function replaceProviderModels(
	provider: string,
	rows: Omit<ProviderModelRow, "provider">[],
): void {
	const db = getDb();
	const insertStmt = db.prepare(
		`INSERT INTO provider_models (
			provider,
			provider_model_id,
			display_name,
			canonical_model_id,
			context_window,
			free,
			updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(provider, provider_model_id) DO UPDATE SET
			display_name = excluded.display_name,
			canonical_model_id = excluded.canonical_model_id,
			context_window = excluded.context_window,
			free = excluded.free,
			updated_at = excluded.updated_at`,
	);
	const run = db.transaction(() => {
		db.run("DELETE FROM provider_models WHERE provider = ?", [provider]);
		for (const row of rows) {
			insertStmt.run(
				provider,
				row.provider_model_id,
				row.display_name,
				row.canonical_model_id,
				row.context_window,
				row.free,
				row.updated_at,
			);
		}
	});
	run();
}

export function setModelInfoState(key: string, value: string): void {
	getDb().run(
		`INSERT INTO model_info_state (key, value) VALUES (?, ?)
		 ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
		[key, value],
	);
}

export function listModelInfoState(): Array<{ key: string; value: string }> {
	return getDb()
		.query<{ key: string; value: string }, []>(
			"SELECT key, value FROM model_info_state",
		)
		.all();
}
