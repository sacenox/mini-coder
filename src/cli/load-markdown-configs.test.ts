import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadMarkdownConfigs } from "./load-markdown-configs.ts";
import { terminal } from "./terminal-io.ts";

let dir: string;
const originalStdoutWrite = terminal.stdoutWrite.bind(terminal);

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "mc-load-markdown-configs-test-"));
	terminal.stdoutWrite = () => {};
});

afterEach(() => {
	terminal.stdoutWrite = originalStdoutWrite;
	rmSync(dir, { recursive: true, force: true });
});

function writeFileAt(parts: string[], content: string): void {
	const filePath = join(dir, ...parts);
	mkdirSync(join(filePath, ".."), { recursive: true });
	writeFileSync(filePath, content);
}

function createDirAt(parts: string[]): void {
	mkdirSync(join(dir, ...parts), { recursive: true });
}

function nextName(prefix: string): string {
	return `${prefix}-${Math.random().toString(36).slice(2)}`;
}

describe("loadMarkdownConfigs", () => {
	test("ignores local .claude dirs when disabled", () => {
		const name = nextName("flat-disabled");
		writeFileAt([".claude", "commands", `${name}.md`], "from claude");

		const configs = loadMarkdownConfigs({
			type: "commands",
			strategy: "flat",
			cwd: dir,
			homeDir: dir,
			includeClaudeDirs: false,
			mapConfig: ({ body, source }) => ({ body, source }),
		});

		expect(configs.get(name)).toBeUndefined();
	});

	test("prefers local .agents over local .claude with the same name", () => {
		const name = nextName("flat-precedence");
		writeFileAt([".claude", "commands", `${name}.md`], "from claude");
		writeFileAt([".agents", "commands", `${name}.md`], "from agents");

		const configs = loadMarkdownConfigs({
			type: "commands",
			strategy: "flat",
			cwd: dir,
			homeDir: dir,
			includeClaudeDirs: true,
			mapConfig: ({ body, source }) => ({ body, source }),
		});

		expect(configs.get(name)).toEqual({ body: "from agents", source: "local" });
	});

	test("uses frontmatter name for nested configs", () => {
		const folderName = nextName("folder");
		const configName = nextName("skill");
		writeFileAt(
			[".agents", "skills", folderName, "SKILL.md"],
			`---\nname: ${configName}\ndescription: Test skill\n---\n\nBody`,
		);

		const configs = loadMarkdownConfigs({
			type: "skills",
			strategy: "nested",
			nestedFileName: "SKILL.md",
			cwd: dir,
			homeDir: dir,
			includeClaudeDirs: false,
			mapConfig: ({ name, body, source }) => ({ name, body, source }),
		});

		expect(configs.has(folderName)).toBe(false);
		expect(configs.get(configName)).toEqual({
			name: configName,
			body: "Body",
			source: "local",
		});
	});

	test("skips directory entries that look like markdown files", () => {
		const badName = `${nextName("bad")}.md`;
		const goodName = nextName("good");
		createDirAt([".agents", "commands", badName]);
		writeFileAt([".agents", "commands", `${goodName}.md`], "ok");

		const configs = loadMarkdownConfigs({
			type: "commands",
			strategy: "flat",
			cwd: dir,
			homeDir: dir,
			includeClaudeDirs: false,
			mapConfig: ({ body }) => body,
		});

		expect(configs.get(goodName)).toBe("ok");
		expect(configs.has(badName.slice(0, -3))).toBe(false);
	});
});
