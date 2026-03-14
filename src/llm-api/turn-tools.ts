import type { FlexibleSchema } from "ai";
import { dynamicTool, jsonSchema } from "ai";
import type { ToolDef } from "./types.ts";

function isZodSchema(s: unknown): boolean {
	return s !== null && typeof s === "object" && "_def" in (s as object);
}

export function toCoreTool(def: ToolDef): ReturnType<typeof dynamicTool> {
	const schema = isZodSchema(def.schema)
		? (def.schema as FlexibleSchema<unknown>)
		: jsonSchema(def.schema);
	return dynamicTool({
		description: def.description,
		inputSchema: schema,
		execute: async (input: unknown) => {
			try {
				return await def.execute(input);
			} catch (err) {
				throw err instanceof Error ? err : new Error(String(err));
			}
		},
	});
}
