import { z } from "zod";
import type { ToolDef } from "../llm-api/types.ts";

const ExaSearchSchema = z.object({
	query: z.string().describe("The search query"),
});

export const webSearchTool: ToolDef<
	z.infer<typeof ExaSearchSchema>,
	unknown
> = {
	name: "webSearch",
	description: "Search the web for a query using Exa.",
	schema: ExaSearchSchema,
	execute: async (input) => {
		const apiKey = process.env.EXA_API_KEY;
		if (!apiKey) {
			throw new Error("EXA_API_KEY is not set.");
		}

		const response = await fetch("https://api.exa.ai/search", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"x-api-key": apiKey,
			},
			body: JSON.stringify({
				query: input.query,
				type: "auto",
				numResults: 10,
				contents: { text: { maxCharacters: 4000 } },
			}),
		});

		if (!response.ok) {
			const errorBody = await response.text();
			throw new Error(
				`Exa API error: ${response.status} ${response.statusText} - ${errorBody}`,
			);
		}

		return await response.json();
	},
};

const ExaContentSchema = z.object({
	urls: z
		.array(z.string())
		.max(3)
		.describe("Array of URLs to retrieve content for (max 3)"),
});

export const webContentTool: ToolDef<
	z.infer<typeof ExaContentSchema>,
	unknown
> = {
	name: "webContent",
	description: "Get the full content of specific URLs using Exa.",
	schema: ExaContentSchema,
	execute: async (input) => {
		const apiKey = process.env.EXA_API_KEY;
		if (!apiKey) {
			throw new Error("EXA_API_KEY is not set.");
		}

		const response = await fetch("https://api.exa.ai/contents", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"x-api-key": apiKey,
			},
			body: JSON.stringify({
				urls: input.urls,
				text: { maxCharacters: 10000 },
			}),
		});

		if (!response.ok) {
			const errorBody = await response.text();
			throw new Error(
				`Exa API error: ${response.status} ${response.statusText} - ${errorBody}`,
			);
		}

		return await response.json();
	},
};
