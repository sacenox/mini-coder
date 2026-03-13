import { z } from "zod";
import {
	type LoadedSkillContent,
	loadSkillContent,
	loadSkillsIndex,
	type SkillMeta,
} from "../cli/skills.ts";
import type { ToolDef } from "../llm-api/types.ts";

const ListSkillsSchema = z.object({});
type ListSkillsInput = { cwd?: string };

interface ListSkillsOutput {
	skills: Array<Pick<SkillMeta, "name" | "description" | "source">>;
}

export const listSkillsTool: ToolDef<ListSkillsInput, ListSkillsOutput> = {
	name: "listSkills",
	description:
		"List available skills metadata (name, description, source) without loading SKILL.md bodies.",
	schema: ListSkillsSchema,
	execute: async (input) => {
		const cwd = input.cwd ?? process.cwd();
		const skills = Array.from(loadSkillsIndex(cwd).values()).map((skill) => ({
			name: skill.name,
			description: skill.description,
			source: skill.source,
		}));
		return { skills };
	},
};

const ReadSkillSchema = z.object({
	name: z.string().describe("Skill name to load, e.g. conventional-commits"),
});
type ReadSkillInput = z.infer<typeof ReadSkillSchema> & { cwd?: string };

interface ReadSkillOutput {
	skill: LoadedSkillContent | null;
}

export const readSkillTool: ToolDef<ReadSkillInput, ReadSkillOutput> = {
	name: "readSkill",
	description: "Load full SKILL.md content for one skill by name.",
	schema: ReadSkillSchema,
	execute: async (input) => {
		const cwd = input.cwd ?? process.cwd();
		return { skill: loadSkillContent(input.name, cwd) };
	},
};
