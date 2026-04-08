/**
 * Agent Skills (agentskills.io) discovery, parsing, and catalog generation.
 *
 * Scans configured directories for `SKILL.md` files, extracts YAML
 * frontmatter (name, description), resolves name collisions (earlier
 * scan paths win), and generates an XML catalog string for inclusion
 * in the system prompt.
 *
 * @module
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A discovered agent skill.
 *
 * Represents a single SKILL.md file that has been parsed and is ready
 * for inclusion in the system prompt catalog.
 */
export interface Skill {
  /** Skill name (from frontmatter or directory name fallback). */
  name: string;
  /** Skill description (from frontmatter, empty if absent). */
  description: string;
  /** Absolute path to the SKILL.md file. */
  path: string;
}

// ---------------------------------------------------------------------------
// Frontmatter parsing
// ---------------------------------------------------------------------------

function getFrontmatterLines(content: string): string[] | null {
  if (!content.startsWith("---")) {
    return null;
  }

  const endIdx = content.indexOf("\n---", 3);
  if (endIdx === -1) {
    return null;
  }

  return content.slice(4, endIdx).split("\n");
}

function parseFrontmatterEntry(
  line: string,
): { key: string; value: string } | null {
  const colonIdx = line.indexOf(":");
  if (colonIdx === -1) {
    return null;
  }

  return {
    key: line.slice(0, colonIdx).trim(),
    value: line.slice(colonIdx + 1).trim(),
  };
}

function isIndentedFrontmatterLine(line: string): boolean {
  return line.startsWith(" ") || line.startsWith("\t");
}

function readFoldedFrontmatterValue(
  lines: string[],
  startIndex: number,
): string {
  const folded: string[] = [];
  for (let i = startIndex; i < lines.length; i++) {
    const line = lines[i];
    if (!line || !isIndentedFrontmatterLine(line)) {
      break;
    }
    folded.push(line.trim());
  }
  return folded.join(" ");
}

function readDescriptionValue(
  lines: string[],
  lineIndex: number,
  value: string,
): string {
  if (value === ">") {
    return readFoldedFrontmatterValue(lines, lineIndex + 1);
  }
  return stripQuotes(value);
}

/**
 * Parse YAML frontmatter from a SKILL.md file's content.
 *
 * Handles simple key-value pairs, quoted strings, and YAML folded
 * scalars (`>`). Does not use a full YAML parser — just enough to
 * extract `name` and `description`.
 *
 * @param content - Raw file content.
 * @returns Extracted name and description (both may be undefined).
 */
function parseFrontmatter(content: string): {
  name: string | undefined;
  description: string | undefined;
} {
  const lines = getFrontmatterLines(content);
  if (!lines) {
    return { name: undefined, description: undefined };
  }

  let name: string | undefined;
  let description: string | undefined;

  for (const [index, line] of lines.entries()) {
    const entry = parseFrontmatterEntry(line);
    if (!entry) {
      continue;
    }
    if (entry.key === "name") {
      name = stripQuotes(entry.value);
      continue;
    }
    if (entry.key === "description") {
      description = readDescriptionValue(lines, index, entry.value);
    }
  }

  return { name, description };
}

/**
 * Strip surrounding single or double quotes from a string.
 *
 * @param s - The string to strip.
 * @returns The string without surrounding quotes.
 */
function stripQuotes(s: string): string {
  if (s.length >= 2) {
    if (
      (s[0] === '"' && s[s.length - 1] === '"') ||
      (s[0] === "'" && s[s.length - 1] === "'")
    ) {
      return s.slice(1, -1);
    }
  }
  return s;
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

function listSkillEntries(basePath: string): string[] {
  if (!existsSync(basePath)) {
    return [];
  }
  try {
    return readdirSync(basePath);
  } catch {
    return [];
  }
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function readSkill(basePath: string, entry: string): Skill | null {
  const dir = join(basePath, entry);
  if (!isDirectory(dir)) {
    return null;
  }

  const skillPath = join(dir, "SKILL.md");
  if (!existsSync(skillPath)) {
    return null;
  }

  const content = readFileSync(skillPath, "utf-8");
  const frontmatter = parseFrontmatter(content);
  return {
    name: frontmatter.name ?? entry,
    description: frontmatter.description ?? "",
    path: skillPath,
  };
}

/**
 * Discover agent skills from the given scan paths.
 *
 * Scans each path for subdirectories containing a `SKILL.md` file.
 * Earlier paths in the array have higher priority — on name collision,
 * the first-seen skill wins (project-level over user-level).
 *
 * @param scanPaths - Ordered directories to scan (project paths first).
 * @returns Array of discovered {@link Skill} records, deduplicated by name.
 */
export function discoverSkills(scanPaths: string[]): Skill[] {
  const seen = new Map<string, Skill>();

  for (const basePath of scanPaths) {
    for (const entry of listSkillEntries(basePath)) {
      const skill = readSkill(basePath, entry);
      if (!skill || seen.has(skill.name)) {
        continue;
      }
      seen.set(skill.name, skill);
    }
  }

  return [...seen.values()];
}

// ---------------------------------------------------------------------------
// Catalog generation
// ---------------------------------------------------------------------------

/**
 * Build the XML skill catalog for the system prompt.
 *
 * Returns the full catalog section including the preamble text and
 * `<available_skills>` XML block. Returns an empty string if no
 * skills are provided.
 *
 * @param skills - Discovered skills to include.
 * @returns The catalog string to append to the system prompt.
 */
export function buildSkillCatalog(skills: Skill[]): string {
  if (skills.length === 0) return "";

  const entries = skills
    .map(
      (s) =>
        `  <skill>\n` +
        `    <name>${s.name}</name>\n` +
        `    <description>${s.description}</description>\n` +
        `    <location>${s.path}</location>\n` +
        `  </skill>`,
    )
    .join("\n");

  return (
    `The following skills provide specialized instructions for specific tasks.\n` +
    `Use the shell tool to read a skill's file when the task matches its description.\n` +
    `When a skill file references a relative path, resolve it against the skill directory (parent of SKILL.md) and use that absolute path in tool commands.\n` +
    `\n` +
    `<available_skills>\n` +
    entries +
    `\n</available_skills>`
  );
}
