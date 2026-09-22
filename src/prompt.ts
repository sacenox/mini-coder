import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { Config } from "./config.ts";

interface Skill {
  name: string;
  description: string;
  path: string;
}

function frontmatter(text: string): { name?: string; description?: string } {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const out: { name?: string; description?: string } = {};
  for (const line of match[1].split(/\r?\n/)) {
    const separator = line.indexOf(":");
    if (separator < 0) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim().replace(/^["']|["']$/g, "");
    if (key === "name") out.name = value;
    if (key === "description") out.description = value;
  }
  return out;
}

function discoverSkills(dirs: string[]): Skill[] {
  const skills: Skill[] = [];
  for (const root of dirs) {
    let entries: string[];
    try {
      entries = readdirSync(root);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const path = resolve(root, entry, "SKILL.md");
      if (!existsSync(path)) continue;
      const meta = frontmatter(readFileSync(path, "utf8"));
      if (!meta.name) continue;
      skills.push({ name: meta.name, description: meta.description ?? "", path });
    }
  }
  return skills;
}

function agentFiles(): { path: string; text: string }[] {
  const roots = [join(homedir(), ".agents"), process.cwd()];
  const found: { path: string; text: string }[] = [];
  for (const root of roots) {
    for (const name of ["AGENTS.md", "CLAUDE.md"]) {
      const path = join(root, name);
      if (existsSync(path)) found.push({ path, text: readFileSync(path, "utf8").trim() });
    }
  }
  return found;
}

export function buildSystemPrompt(config: Config): string {
  const sections: string[] = [];
  if (config.systemPrompt.trim()) sections.push(config.systemPrompt.trim());

  if (config.skillsDirs.length > 0) {
    const skills = discoverSkills(config.skillsDirs);
    if (skills.length > 0) {
      sections.push(
        "## Skills\n\n" + skills.map((s) => `- ${s.name}: ${s.description} (${s.path})`).join("\n"),
      );
    }
  }

  if (config.discoverAgentFiles) {
    for (const file of agentFiles()) {
      sections.push(`## ${file.path}\n\n${file.text}`);
    }
  }

  return sections.join("\n\n");
}
