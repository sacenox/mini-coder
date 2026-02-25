import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadAgents } from "./agents.ts";

describe("loadAgents", () => {
	let dir: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "mc-agents-test-"));
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	function writeAgent(root: string, name: string, content: string): void {
		const agentsDir = join(root, ".agents", "agents");
		mkdirSync(agentsDir, { recursive: true });
		writeFileSync(join(agentsDir, `${name}.md`), content);
	}

	test("returns empty map when no .agents/agents dir exists", () => {
		expect(loadAgents(dir).size).toBe(0);
	});

	test("loads an agent with frontmatter", () => {
		writeAgent(
			dir,
			"reviewer",
			"---\ndescription: Code reviewer\nmodel: zen/claude-3-5-haiku\n---\n\nYou are a strict code reviewer.",
		);
		const agents = loadAgents(dir);
		const agent = agents.get("reviewer");
		expect(agent?.description).toBe("Code reviewer");
		expect(agent?.model).toBe("zen/claude-3-5-haiku");
		expect(agent?.systemPrompt).toBe("You are a strict code reviewer.");
		expect(agent?.source).toBe("local");
	});

	test("falls back to name as description when frontmatter has none", () => {
		writeAgent(dir, "helper", "You help with things.");
		expect(loadAgents(dir).get("helper")?.description).toBe("helper");
	});

	test("body without frontmatter is used as systemPrompt verbatim", () => {
		writeAgent(dir, "plain", "Just do the task.");
		expect(loadAgents(dir).get("plain")?.systemPrompt).toBe(
			"Just do the task.",
		);
	});

	test("ignores non-.md files", () => {
		const agentsDir = join(dir, ".agents", "agents");
		mkdirSync(agentsDir, { recursive: true });
		writeFileSync(join(agentsDir, "script.sh"), "echo hi");
		expect(loadAgents(dir).size).toBe(0);
	});

	test("local agent overrides global with same name", () => {
		// Write a local agent; global would be ~/.agents/agents/ (not writable in test)
		writeAgent(
			dir,
			"reviewer",
			"---\ndescription: local reviewer\n---\nLocal prompt",
		);
		const agents = loadAgents(dir);
		expect(agents.get("reviewer")?.description).toBe("local reviewer");
		expect(agents.get("reviewer")?.source).toBe("local");
	});
});
