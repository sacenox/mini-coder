import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { resolvePath } from "../tools/shared.ts";
import { buildToolSet } from "./tools.ts";

let cwd = "";

beforeEach(() => {
	cwd = mkdtempSync(join(tmpdir(), "agent-tools-test-"));
});

afterEach(() => {
	rmSync(cwd, { recursive: true, force: true });
});

function makeHook(toolName: string, body: string): void {
	const hooksDir = join(cwd, ".agents", "hooks");
	mkdirSync(hooksDir, { recursive: true });
	writeFileSync(join(hooksDir, `post-${toolName}`), body, { mode: 0o755 });
}

function getTool(name: string) {
	const tool = buildToolSet({
		cwd,
		runSubagent: async () => {
			throw new Error("subagent should not run in this test");
		},
		onHook: () => {},
		availableAgents: new Map(),
	}).find((candidate) => candidate.name === name);
	if (!tool) throw new Error(`Tool not found: ${name}`);
	return tool;
}

describe("buildToolSet write hooks", () => {
	test("create returns a diff for the post-hook file state", async () => {
		makeHook("create", '#!/bin/bash\nprintf "formatted\\n" > "$FILEPATH"\n');

		const result = await getTool("create").execute({
			path: "f.txt",
			content: "draft\n",
		});

		expect(await Bun.file(join(cwd, "f.txt")).text()).toBe("formatted\n");
		expect(result).toMatchObject({ path: "f.txt", created: true });
		expect(result).not.toHaveProperty("_before");
		expect(result).not.toHaveProperty("_filePath");
		expect((result as { diff: string }).diff).toContain("+formatted");
		expect((result as { diff: string }).diff).not.toContain("+draft");
	});

	test("write tools still return the expected diff when no hook exists", async () => {
		const result = await getTool("create").execute({
			path: "plain.txt",
			content: "plain\n",
		});

		expect(await Bun.file(join(cwd, "plain.txt")).text()).toBe("plain\n");
		expect((result as { diff: string }).diff).toContain("+plain");
		expect(result).not.toHaveProperty("_before");
	});
});

describe("tool set registration", () => {
	test("includes listSkills and readSkill in full tool set", () => {
		const names = buildToolSet({
			cwd,
			runSubagent: async () => ({
				result: "ok",
				inputTokens: 0,
				outputTokens: 0,
			}),
			onHook: () => {},
			availableAgents: new Map(),
		}).map((tool) => tool.name);

		expect(names).toContain("listSkills");
		expect(names).toContain("readSkill");
		expect(names).not.toContain("replace");
		expect(names).not.toContain("insert");
	});
});

describe("resolvePath", () => {
	test("expands ~ to home directory", () => {
		const { filePath } = resolvePath("/any/cwd", "~/foo/bar");
		expect(filePath).toBe(join(homedir(), "foo/bar"));
	});

	test("resolves absolute path as-is", () => {
		const { filePath } = resolvePath("/any/cwd", "/tmp/foo");
		expect(filePath).toBe("/tmp/foo");
	});

	test("resolves relative path against cwd", () => {
		const { filePath } = resolvePath("/my/cwd", "foo/bar");
		expect(filePath).toBe("/my/cwd/foo/bar");
	});

	test("normalizes quoted and padded path input", () => {
		const { filePath } = resolvePath("/my/cwd", '  "~/foo/bar"  ');
		expect(filePath).toBe(join(homedir(), "foo/bar"));
	});
});
