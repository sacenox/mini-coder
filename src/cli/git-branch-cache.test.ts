import { describe, expect, test } from "bun:test";
import { createGitBranchCache } from "./git-branch-cache.ts";

describe("createGitBranchCache", () => {
	test("stores fetched branch value", async () => {
		const cache = createGitBranchCache({
			cwd: "/tmp",
			fetchBranch: async () => "main",
			ttlMs: 10_000,
			now: () => 0,
		});

		expect(cache.get()).toBeNull();
		await cache.refresh(true);
		expect(cache.get()).toBe("main");
	});

	test("does not refetch within ttl window", async () => {
		let calls = 0;
		let nowValue = 1000;
		const cache = createGitBranchCache({
			cwd: "/tmp",
			fetchBranch: async () => {
				calls++;
				return "dev";
			},
			ttlMs: 5000,
			now: () => nowValue,
		});

		await cache.refresh(true);
		await cache.refresh();
		nowValue += 1000;
		await cache.refresh();

		expect(calls).toBe(1);
	});

	test("refetches after ttl expires", async () => {
		let calls = 0;
		let nowValue = 1000;
		const cache = createGitBranchCache({
			cwd: "/tmp",
			fetchBranch: async () => {
				calls++;
				return calls === 1 ? "dev" : "feature";
			},
			ttlMs: 500,
			now: () => nowValue,
		});

		await cache.refresh(true);
		nowValue += 1000;
		await cache.refresh();

		expect(calls).toBe(2);
		expect(cache.get()).toBe("feature");
	});

	test("coalesces concurrent refreshes", async () => {
		let calls = 0;
		let resolveFetch!: (value: string) => void;
		const fetchPromise = new Promise<string>((resolve) => {
			resolveFetch = resolve;
		});
		const cache = createGitBranchCache({
			cwd: "/tmp",
			fetchBranch: async () => {
				calls++;
				return fetchPromise;
			},
			ttlMs: 5000,
			now: () => 0,
		});

		const first = cache.refresh(true);
		const second = cache.refresh(true);
		resolveFetch("main");
		await Promise.all([first, second]);

		expect(calls).toBe(1);
		expect(cache.get()).toBe("main");
	});
});
