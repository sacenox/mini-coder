import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
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

describe("tool set registration", () => {
	test("keeps shell, subagent, and skill tools while removing local file tools", () => {
		const names = buildToolSet({
			cwd,
			runSubagent: async () => ({
				result: "ok",
				inputTokens: 0,
				outputTokens: 0,
			}),
			availableAgents: new Map(),
		}).map((tool) => tool.name);

		expect(names).toContain("shell");
		expect(names).toContain("subagent");
		expect(names).toContain("listSkills");
		expect(names).toContain("readSkill");
		expect(names).not.toContain("read");
		expect(names).not.toContain("create");
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
