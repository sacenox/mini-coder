import { getGitBranch } from "./cli-helpers.ts";

type BranchFetcher = (cwd: string) => Promise<string | null>;

type GitBranchCacheOptions = {
	cwd: string;
	ttlMs?: number;
	fetchBranch?: BranchFetcher;
	now?: () => number;
};

export function createGitBranchCache(options: GitBranchCacheOptions): {
	get: () => string | null;
	refresh: (force?: boolean) => Promise<void>;
	refreshInBackground: (force?: boolean) => void;
} {
	const fetchBranch = options.fetchBranch ?? getGitBranch;
	const now = options.now ?? Date.now;
	const ttlMs = options.ttlMs ?? 5000;

	let value: string | null = null;
	let lastRefreshAt = 0;
	let inFlight: Promise<void> | null = null;

	const refresh = async (force = false): Promise<void> => {
		if (!force && now() - lastRefreshAt < ttlMs) return;
		if (inFlight) {
			await inFlight;
			return;
		}

		inFlight = (async () => {
			value = await fetchBranch(options.cwd);
			lastRefreshAt = now();
		})().finally(() => {
			inFlight = null;
		});

		await inFlight;
	};

	return {
		get: () => value,
		refresh,
		refreshInBackground: (force = false) => {
			void refresh(force);
		},
	};
}
