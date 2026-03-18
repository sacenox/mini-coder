import type { ModelCapabilityRow } from "../session/db/model-info-repo.ts";
import { isRecord } from "./history/shared.ts";

interface ModelsDevEntry {
	canonicalModelId: string;
	contextWindow: number | null;
	reasoning: boolean;
	sourceProvider: string;
	rawJson: string | null;
}

export interface ModelMatchIndex {
	exact: Map<string, string>;
	alias: Map<string, string | null>;
}

function basename(value: string): string {
	const idx = value.lastIndexOf("/");
	return idx === -1 ? value : value.slice(idx + 1);
}

export function normalizeModelId(modelId: string): string {
	let out = modelId.trim().toLowerCase();
	while (out.startsWith("models/")) {
		out = out.slice("models/".length);
	}
	return out;
}

function parseContextWindow(model: Record<string, unknown>): number | null {
	const limit = model.limit;
	if (!isRecord(limit)) return null;
	const context = limit.context;
	if (typeof context !== "number" || !Number.isFinite(context)) return null;
	return Math.max(0, Math.trunc(context));
}

export function parseModelsDevCapabilities(
	payload: unknown,
	updatedAt: number,
): ModelCapabilityRow[] {
	if (!isRecord(payload)) return [];

	const merged = new Map<string, ModelsDevEntry>();
	for (const [provider, providerValue] of Object.entries(payload)) {
		if (!isRecord(providerValue)) continue;
		const models = providerValue.models;
		if (!isRecord(models)) continue;
		for (const [modelKey, modelValue] of Object.entries(models)) {
			if (!isRecord(modelValue)) continue;
			const explicitId =
				typeof modelValue.id === "string" && modelValue.id.trim().length > 0
					? modelValue.id
					: modelKey;
			const canonicalModelId = normalizeModelId(explicitId);
			if (!canonicalModelId) continue;
			const contextWindow = parseContextWindow(modelValue);
			const reasoning = modelValue.reasoning === true;
			const rawJson = JSON.stringify(modelValue);
			const prev = merged.get(canonicalModelId);
			if (!prev) {
				merged.set(canonicalModelId, {
					canonicalModelId,
					contextWindow,
					reasoning,
					sourceProvider: provider,
					rawJson,
				});
				continue;
			}
			merged.set(canonicalModelId, {
				canonicalModelId,
				contextWindow: prev.contextWindow ?? contextWindow,
				reasoning: prev.reasoning || reasoning,
				sourceProvider: prev.sourceProvider,
				rawJson: prev.rawJson ?? rawJson,
			});
		}
	}

	return Array.from(merged.values()).map((entry) => ({
		canonical_model_id: entry.canonicalModelId,
		context_window: entry.contextWindow,
		reasoning: entry.reasoning ? 1 : 0,
		source_provider: entry.sourceProvider,
		raw_json: entry.rawJson,
		updated_at: updatedAt,
	}));
}

export function buildModelMatchIndex(
	canonicalModelIds: Iterable<string>,
): ModelMatchIndex {
	const exact = new Map<string, string>();
	const aliasCandidates = new Map<string, Set<string>>();

	for (const rawCanonical of canonicalModelIds) {
		const canonical = normalizeModelId(rawCanonical);
		if (!canonical) continue;
		exact.set(canonical, canonical);
		const short = basename(canonical);
		if (!short) continue;
		let set = aliasCandidates.get(short);
		if (!set) {
			set = new Set<string>();
			aliasCandidates.set(short, set);
		}
		set.add(canonical);
	}

	const alias = new Map<string, string | null>();
	for (const [short, candidates] of aliasCandidates) {
		if (candidates.size === 1) {
			for (const value of candidates) {
				alias.set(short, value);
			}
		} else {
			alias.set(short, null);
		}
	}

	return { exact, alias };
}

export function matchCanonicalModelId(
	providerModelId: string,
	index: ModelMatchIndex,
): string | null {
	const normalized = normalizeModelId(providerModelId);
	if (!normalized) return null;
	const exactMatch = index.exact.get(normalized);
	if (exactMatch) return exactMatch;
	const short = basename(normalized);
	if (!short) return null;
	const alias = index.alias.get(short);
	return alias ?? null;
}
