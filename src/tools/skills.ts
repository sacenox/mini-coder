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
	skills: Array<Pick<SkillMeta, "name" | "description" | "source" | "context">>;
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
			...(skill.context && { context: skill.context }),
		}));
		return { skills };
	},
};

const ReadSkillSchema = z.object({
	name: z.string().describe("Skill name to load"),
});
type ReadSkillInput = z.infer<typeof ReadSkillSchema> & { cwd?: string };

interface ReadSkillOutput {
	skill: LoadedSkillContent | null;
	fork?: boolean;
	note?: string;
}

const activatedSkills = new Set<string>();

export const readSkillTool: ToolDef<ReadSkillInput, ReadSkillOutput> = {
	name: "readSkill",
	description: "Load full SKILL.md content for one skill by name.",
	schema: ReadSkillSchema,
	execute: async (input) => {
		const cwd = input.cwd ?? process.cwd();
		if (activatedSkills.has(input.name)) {
			return {
				skill: null,
				note: `Skill "${input.name}" is already loaded in this session.`,
			};
		}
		const index = loadSkillsIndex(cwd);
		const meta = index.get(input.name);
		if (meta?.context === "fork") {
			activatedSkills.add(input.name);
			const skill = loadSkillContent(input.name, cwd);
			return {
				skill,
				fork: true,
				note: `This skill has "context: fork" — run it in an isolated subagent via shell: mc < "${meta.filePath}"  — pipe the skill content as the prompt. Only report the final result to the user, keeping this conversation context clean.`,
			};
		}
		const skill = loadSkillContent(input.name, cwd);
		if (skill) activatedSkills.add(input.name);
		return { skill };
	},
};
