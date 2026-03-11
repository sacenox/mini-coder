import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hashLine } from "../tools/hashline.ts";
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

	test("replace returns a diff for hook-mutated file contents", async () => {
		writeFileSync(join(cwd, "f.txt"), "a\nb\n");
		makeHook(
			"replace",
			'#!/bin/bash\nprintf "a\\nB\\nformatted\\n" > "$FILEPATH"\n',
		);

		const result = await getTool("replace").execute({
			path: "f.txt",
			startAnchor: `2:${hashLine("b")}`,
			newContent: "B",
		});

		expect(await Bun.file(join(cwd, "f.txt")).text()).toBe("a\nB\nformatted\n");
		expect((result as { diff: string }).diff).toContain("+formatted");
		expect((result as { diff: string }).diff).not.toBe("(no changes)");
	});

	test("insert returns a diff for hook-mutated file contents", async () => {
		writeFileSync(join(cwd, "f.txt"), "a\nb\n");
		makeHook(
			"insert",
			'#!/bin/bash\nprintf "a\\nnew\\nb\\nformatted\\n" > "$FILEPATH"\n',
		);

		const result = await getTool("insert").execute({
			path: "f.txt",
			anchor: `1:${hashLine("a")}`,
			position: "after",
			content: "new",
		});

		expect(await Bun.file(join(cwd, "f.txt")).text()).toBe(
			"a\nnew\nb\nformatted\n",
		);
		expect((result as { diff: string }).diff).toContain("+formatted");
		expect((result as { diff: string }).diff).not.toMatch(/^-b$/m);
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
