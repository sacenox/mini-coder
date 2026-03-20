import { z } from "zod";
import type { ToolDef } from "../llm-api/types.ts";

const ExaSearchSchema = z.object({
  query: z.string().describe("The search query"),
});

async function fetchExa(endpoint: string, body: unknown) {
  const apiKey = process.env.EXA_API_KEY;
  if (!apiKey) {
    throw new Error("EXA_API_KEY is not set.");
  }

  const response = await fetch(`https://api.exa.ai/${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(
      `Exa API error: ${response.status} ${response.statusText} - ${errorBody}`,
    );
  }

  return await response.json();
}

export const webSearchTool: ToolDef<
  z.infer<typeof ExaSearchSchema>,
  unknown
> = {
  name: "webSearch",
  description: "Search the web for a query using Exa.",
  schema: ExaSearchSchema,
  execute: async (input) => {
    return fetchExa("search", {
      query: input.query,
      type: "auto",
      numResults: 10,
      contents: { text: { maxCharacters: 4000 } },
    });
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
    return fetchExa("contents", {
      urls: input.urls,
      text: { maxCharacters: 10000 },
    });
  },
};
