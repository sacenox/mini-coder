import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHookCache, runHook } from "./hooks.ts";

// ─── Helpers ──────────────────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
	tmpDir = mkdtempSync(join(tmpdir(), "hooks-test-"));
});

afterEach(() => {
	rmSync(tmpDir, { recursive: true, force: true });
});

function makeHook(dir: string, name: string, content: string): string {
	const hooksDir = join(dir, ".agents", "hooks");
	mkdirSync(hooksDir, { recursive: true });
	const scriptPath = join(hooksDir, name);
	writeFileSync(scriptPath, content, { mode: 0o755 });
	return scriptPath;
}

// ─── createHookCache ──────────────────────────────────────────────────────────

describe("createHookCache", () => {
	it("returns null when no hook exists", () => {
		const lookup = createHookCache(["create"], tmpDir);
		expect(lookup("create")).toBeNull();
	});

	it("returns the script path when an executable hook exists", () => {
		const scriptPath = makeHook(tmpDir, "post-create", "#!/bin/bash\necho hi");
		const lookup = createHookCache(["create"], tmpDir);
		expect(lookup("create")).toBe(scriptPath);
	});

	it("returns null when the hook file exists but is not executable", () => {
		const hooksDir = join(tmpDir, ".agents", "hooks");
		mkdirSync(hooksDir, { recursive: true });
		writeFileSync(join(hooksDir, "post-replace"), "#!/bin/bash\necho hi", {
			mode: 0o644,
		});
		const lookup = createHookCache(["replace"], tmpDir);
		expect(lookup("replace")).toBeNull();
	});

	it("returns null for an unknown tool name not in the cache", () => {
		makeHook(tmpDir, "post-shell", "#!/bin/bash\necho hi");
		const lookup = createHookCache(["shell"], tmpDir);
		expect(lookup("create")).toBeNull();
	});

	it("resolves hooks only once — adding a script after cache creation is not visible", () => {
		const lookup = createHookCache(["create"], tmpDir);
		// Cache is already built: hook did not exist at construction time
		makeHook(tmpDir, "post-create", "#!/bin/bash\necho hi");
		expect(lookup("create")).toBeNull();
	});
});

// ─── runHook ──────────────────────────────────────────────────────────────────

describe("runHook", () => {
	it("completes without throwing when the script exits zero", async () => {
		const script = makeHook(tmpDir, "post-create", "#!/bin/bash\nexit 0");
		await expect(
			runHook(script, { TOOL: "create" }, tmpDir),
		).resolves.toBeUndefined();
	});

	it("completes without throwing when the script exits non-zero", async () => {
		const script = makeHook(tmpDir, "post-replace", "#!/bin/bash\nexit 1");
		await expect(
			runHook(script, { TOOL: "replace" }, tmpDir),
		).resolves.toBeUndefined();
	});

	it("completes without throwing when the script path does not exist", async () => {
		const missing = join(tmpDir, ".agents", "hooks", "post-missing");
		await expect(runHook(missing, {}, tmpDir)).resolves.toBeUndefined();
	});

	it("passes env vars to the hook script", async () => {
		const outFile = join(tmpDir, "out.txt");
		const script = makeHook(
			tmpDir,
			"post-insert",
			`#!/bin/bash\necho "$FILEPATH" > "${outFile}"`,
		);
		await runHook(script, { FILEPATH: "src/foo.ts" }, tmpDir);
		const written = await Bun.file(outFile).text();
		expect(written.trim()).toBe("src/foo.ts");
	});

	it("exposes TIMED_OUT env var to the hook script", async () => {
		const outFile = join(tmpDir, "out.txt");
		const script = makeHook(
			tmpDir,
			"post-shell",
			`#!/bin/bash\necho "$TIMED_OUT" > "${outFile}"`,
		);
		await runHook(script, { TIMED_OUT: "true" }, tmpDir);
		const written = await Bun.file(outFile).text();
		expect(written.trim()).toBe("true");
	});
});
