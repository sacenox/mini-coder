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
  // Frontmatter must start with ---
  if (!content.startsWith("---")) {
    return { name: undefined, description: undefined };
  }

  const endIdx = content.indexOf("\n---", 3);
  if (endIdx === -1) {
    return { name: undefined, description: undefined };
  }

  const frontmatter = content.slice(4, endIdx); // skip opening "---\n"
  const lines = frontmatter.split("\n");

  let name: string | undefined;
  let description: string | undefined;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;

    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();

    if (key === "name") {
      name = stripQuotes(value);
    } else if (key === "description") {
      // Handle folded scalar (>)
      if (value === ">") {
        const folded: string[] = [];
        for (let j = i + 1; j < lines.length; j++) {
          const nextLine = lines[j]!;
          // Continuation lines must be indented
          if (
            nextLine.length > 0 &&
            (nextLine[0] === " " || nextLine[0] === "\t")
          ) {
            folded.push(nextLine.trim());
          } else {
            break;
          }
        }
        description = folded.join(" ");
      } else {
        description = stripQuotes(value);
      }
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
    if (!existsSync(basePath)) continue;

    let entries: string[];
    try {
      entries = readdirSync(basePath);
    } catch {
      continue;
    }

    for (const entry of entries) {
      const dir = join(basePath, entry);
      const skillPath = join(dir, "SKILL.md");

      // Must be a directory containing SKILL.md
      try {
        if (!statSync(dir).isDirectory()) continue;
      } catch {
        continue;
      }
      if (!existsSync(skillPath)) continue;

      const content = readFileSync(skillPath, "utf-8");
      const fm = parseFrontmatter(content);

      const name = fm.name ?? entry;
      const description = fm.description ?? "";

      // First-seen wins (earlier scan paths have higher priority)
      if (!seen.has(name)) {
        seen.set(name, { name, description, path: skillPath });
      }
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
