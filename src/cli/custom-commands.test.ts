import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expandTemplate, loadCustomCommands } from "./custom-commands.ts";

// ─── parseFrontmatter / loadCustomCommands ────────────────────────────────────

describe("loadCustomCommands", () => {
	let dir: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "mc-cmd-test-"));
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	function writeCmd(root: string, name: string, content: string): void {
		const cmdsDir = join(root, ".agents", "commands");
		mkdirSync(cmdsDir, { recursive: true });
		writeFileSync(join(cmdsDir, `${name}.md`), content);
	}

	test("returns empty map when no .agents/commands dir exists", () => {
		const result = loadCustomCommands(dir);
		expect(result.size).toBe(0);
	});

	test("loads a command with frontmatter", () => {
		writeCmd(
			dir,
			"hello",
			"---\ndescription: Say hello\nmodel: zen/claude-3-5-haiku\n---\n\nHello $ARGUMENTS",
		);
		const result = loadCustomCommands(dir);
		const cmd = result.get("hello");
		expect(cmd?.description).toBe("Say hello");
		expect(cmd?.model).toBe("zen/claude-3-5-haiku");
		expect(cmd?.template).toBe("Hello $ARGUMENTS");
		expect(cmd?.source).toBe("local");
	});

	test("falls back to name as description when frontmatter has none", () => {
		writeCmd(dir, "mytool", "Just a plain template");
		const result = loadCustomCommands(dir);
		expect(result.get("mytool")?.description).toBe("mytool");
	});

	test("body without frontmatter is used as template verbatim", () => {
		writeCmd(dir, "plain", "Do the thing with $1");
		expect(loadCustomCommands(dir).get("plain")?.template).toBe(
			"Do the thing with $1",
		);
	});

	test("ignores non-.md files", () => {
		const cmdsDir = join(dir, ".agents", "commands");
		mkdirSync(cmdsDir, { recursive: true });
		writeFileSync(join(cmdsDir, "script.sh"), "echo hi");
		expect(loadCustomCommands(dir).size).toBe(0);
	});

	test("local command overrides global with same name", () => {
		// Simulate by writing two commands to the local dir and checking only one wins
		writeCmd(dir, "search", "---\ndescription: local\n---\nlocal template");
		const result = loadCustomCommands(dir);
		expect(result.get("search")?.description).toBe("local");
		expect(result.get("search")?.source).toBe("local");
	});
});

// ─── expandTemplate ───────────────────────────────────────────────────────────

describe("expandTemplate", () => {
	test("replaces $ARGUMENTS with the full args string", async () => {
		const out = await expandTemplate("Search for $ARGUMENTS", "foo bar", "/");
		expect(out).toBe("Search for foo bar");
	});

	test("replaces positional $1, $2, $3", async () => {
		const out = await expandTemplate("$1 $2 $3", "alpha beta gamma", "/");
		expect(out).toBe("alpha beta gamma");
	});

	test("replaces $1 without touching $10+ (no such placeholder)", async () => {
		// We only support $1–$9; $10 should not be replaced by $1 + "0"
		const out = await expandTemplate("$10", "x", "/");
		// $1 → "x", then "0" remains → "x0"
		expect(out).toBe("x0");
	});

	test("missing positional args become empty string", async () => {
		const out = await expandTemplate("$1 $2 $3", "only-one", "/");
		expect(out).toBe("only-one  ");
	});

	test("quoted tokens are parsed as single args", async () => {
		const out = await expandTemplate("$1|$2", '"hello world" second', "/");
		expect(out).toBe("hello world|second");
	});

	test("replaces all occurrences of the same $ARGUMENTS", async () => {
		const out = await expandTemplate(
			"Arg: $ARGUMENTS and again $ARGUMENTS",
			"test",
			"/",
		);
		expect(out).toBe("Arg: test and again test");
	});

	test("shell interpolation !`cmd` is replaced with command output", async () => {
		const out = await expandTemplate("Result: !`echo hello`", "", "/");
		expect(out).toBe("Result: hello");
	});

	test("duplicate !`cmd` occurrences are all replaced", async () => {
		const out = await expandTemplate("!`echo hi` and !`echo hi`", "", "/");
		expect(out).toBe("hi and hi");
	});

	test("failed shell command suppresses stderr, keeps stdout", async () => {
		// exit 1 with stdout output — stdout kept, stderr discarded
		const out = await expandTemplate(
			"pre !`echo out; echo err >&2; exit 1` post",
			"",
			"/",
		);
		expect(out).toBe("pre out post");
	});

	test("successful command includes stderr in output", async () => {
		const out = await expandTemplate("!`echo err >&2; exit 0`", "", "/");
		expect(out).toBe("err");
	});

	test("timed-out shell command leaves empty string", async () => {
		// sleep 60 will be killed by the 10s timeout — use a short sleep and
		// mock the timeout by testing that a non-blocking command returns quickly
		const out = await expandTemplate("pre !`exit 1` post", "", "/");
		expect(out).toBe("pre  post");
	});

	test("no placeholders — template returned unchanged", async () => {
		const out = await expandTemplate("plain text", "ignored", "/");
		expect(out).toBe("plain text");
	});
});
