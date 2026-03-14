import { describe, expect, test } from "bun:test";
import { getCommandCompletions } from "./completions.ts";

describe("getCommandCompletions", () => {
	const cwd = process.cwd();

	test("completes partial command name", () => {
		const results = getCommandCompletions("/mod", cwd);
		expect(results).toContain("/model");
		expect(results).toContain("/models");
	});

	test("completes /m to multiple commands", () => {
		const results = getCommandCompletions("/m", cwd);
		expect(results).toContain("/model");
		expect(results).toContain("/models");
		expect(results).toContain("/mcp");
	});

	test("returns empty for unknown command prefix", () => {
		const results = getCommandCompletions("/zzz", cwd);
		expect(results).toEqual([]);
	});

	test("completes /model subcommand", () => {
		const results = getCommandCompletions("/model ", cwd);
		expect(results).toContain("/model effort");
	});

	test("completes /model effort values", () => {
		const results = getCommandCompletions("/model effort l", cwd);
		expect(results).toContain("/model effort low");
	});

	test("completes /reasoning params", () => {
		const results = getCommandCompletions("/reasoning o", cwd);
		expect(results).toContain("/reasoning on");
		expect(results).toContain("/reasoning off");
	});

	test("completes /context subcommands", () => {
		const results = getCommandCompletions("/context p", cwd);
		expect(results).toContain("/context prune");
	});

	test("completes /context prune values", () => {
		const results = getCommandCompletions("/context prune b", cwd);
		expect(results).toContain("/context prune balanced");
	});

	test("completes /cache subcommands", () => {
		const results = getCommandCompletions("/cache o", cwd);
		expect(results).toContain("/cache on");
		expect(results).toContain("/cache off");
		expect(results).toContain("/cache openai");
	});

	test("completes /cache openai values", () => {
		const results = getCommandCompletions("/cache openai i", cwd);
		expect(results).toContain("/cache openai in_memory");
	});

	test("completes /mcp subcommands", () => {
		const results = getCommandCompletions("/mcp ", cwd);
		expect(results).toContain("/mcp list");
		expect(results).toContain("/mcp add");
		expect(results).toContain("/mcp remove");
		expect(results).toContain("/mcp rm");
	});

	test("completes /agent with off", () => {
		const results = getCommandCompletions("/agent o", cwd);
		expect(results).toContain("/agent off");
	});

	test("exact match for single-word command", () => {
		const results = getCommandCompletions("/undo", cwd);
		expect(results).toEqual(["/undo"]);
	});

	test("/ alone lists all commands", () => {
		const results = getCommandCompletions("/", cwd);
		expect(results.length).toBeGreaterThan(5);
		expect(results).toContain("/model");
		expect(results).toContain("/help");
	});

	test("returns empty for fourth token", () => {
		const results = getCommandCompletions("/cache openai in_memory extra", cwd);
		expect(results).toEqual([]);
	});
});
