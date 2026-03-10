import { describe, expect, test } from "bun:test";
import { parseFrontmatter } from "./frontmatter.ts";

describe("parseFrontmatter", () => {
	test("parses frontmatter with CRLF line endings", () => {
		const raw =
			"---\r\nname: reviewer\r\ndescription: Reviews code\r\nmodel: openai/gpt-5\r\n---\r\n\r\nBe strict.\r\n";
		expect(parseFrontmatter(raw)).toEqual({
			meta: {
				name: "reviewer",
				description: "Reviews code",
				model: "openai/gpt-5",
			},
			body: "Be strict.",
		});
	});

	test("preserves colons inside quoted values", () => {
		const raw =
			'---\ndescription: "Review: fast"\nmodel: "openai/gpt:mini"\n---\n\nPrompt';
		expect(parseFrontmatter(raw)).toEqual({
			meta: {
				description: "Review: fast",
				model: "openai/gpt:mini",
			},
			body: "Prompt",
		});
	});

	test("ignores unknown frontmatter keys", () => {
		const raw = "---\nname: helper\nfoo: bar\n---\n\nRun it";
		expect(parseFrontmatter(raw)).toEqual({
			meta: {
				name: "helper",
			},
			body: "Run it",
		});
	});

	test("returns the raw input when the closing fence is missing", () => {
		const raw = "---\nname: helper\ndescription: Missing end";
		expect(parseFrontmatter(raw)).toEqual({
			meta: {},
			body: raw,
		});
	});

	test("parses mode field for valid values", () => {
		const raw = "---\nname: reviewer\nmode: primary\n---\n\nDo a review.";
		expect(parseFrontmatter(raw).meta.mode).toBe("primary");
	});

	test("parses mode: subagent and mode: all", () => {
		expect(parseFrontmatter("---\nmode: subagent\n---\n\nBody").meta.mode).toBe(
			"subagent",
		);
		expect(parseFrontmatter("---\nmode: all\n---\n\nBody").meta.mode).toBe(
			"all",
		);
	});

	test("ignores invalid mode values", () => {
		const raw = "---\nmode: unknown\n---\n\nBody";
		expect(parseFrontmatter(raw).meta.mode).toBeUndefined();
	});

	test("parses agent field for commands", () => {
		const raw =
			"---\ndescription: Run tests\nagent: build\n---\n\nRun npm test";
		expect(parseFrontmatter(raw).meta.agent).toBe("build");
	});

	test("parses context: fork", () => {
		const raw = "---\ndescription: Deploy\ncontext: fork\n---\n\nDeploy it";
		expect(parseFrontmatter(raw).meta.context).toBe("fork");
	});

	test("ignores unknown context values", () => {
		const raw = "---\ncontext: inline\n---\n\nBody";
		expect(parseFrontmatter(raw).meta.context).toBeUndefined();
	});

	test("parses subtask: true", () => {
		const raw = "---\nsubtask: true\n---\n\nBody";
		expect(parseFrontmatter(raw).meta.subtask).toBe(true);
	});

	test("parses subtask: false", () => {
		const raw = "---\nsubtask: false\n---\n\nBody";
		expect(parseFrontmatter(raw).meta.subtask).toBe(false);
	});
});
