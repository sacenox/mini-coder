/**
 * System prompt construction.
 *
 * Assembles the full system prompt from static base instructions and
 * dynamic context: AGENTS.md files, skill catalog, plugin suffixes,
 * and a session footer with date, CWD, and git state.
 *
 * @module
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import type { GitState } from "./git.ts";
import { canonicalizePath } from "./paths.ts";
import { buildSkillCatalog, type Skill } from "./skills.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A discovered AGENTS.md file with its content. */
export interface AgentsMdFile {
  /** Absolute path to the file. */
  path: string;
  /** Raw file content. */
  content: string;
}

/** Options for building the system prompt. */
interface BuildSystemPromptOpts {
  /** Current working directory. */
  cwd: string;
  /** Current date string (YYYY-MM-DD). */
  date: string;
  /** Git repository state, or `null`/`undefined` if not in a repo. */
  git?: GitState | null;
  /** Discovered AGENTS.md files, ordered root-to-leaf. */
  agentsMd?: AgentsMdFile[];
  /** Discovered agent skills. */
  skills?: Skill[];
  /** Plugin system prompt suffixes. */
  pluginSuffixes?: string[];
}

// ---------------------------------------------------------------------------
// AGENTS.md discovery
// ---------------------------------------------------------------------------

/** File name to look for during the AGENTS.md walk. */
const AGENT_FILENAME = "AGENTS.md";

/** Resolve the AGENTS.md scan root from git/home/env inputs. */
export function resolveAgentsScanRoot(
  _cwd: string,
  gitRoot: string | null,
  homeDir: string,
  agentsRootEnv = process.env.MC_AGENTS_ROOT,
): string {
  if (gitRoot) {
    return canonicalizePath(gitRoot);
  }
  if (agentsRootEnv === "/") {
    return canonicalizePath("/");
  }
  return canonicalizePath(homeDir);
}

function isWithinScanRoot(path: string, scanRoot: string): boolean {
  const relativePath = relative(scanRoot, path);
  return (
    relativePath === "" ||
    (!relativePath.startsWith("..") && relativePath !== "..")
  );
}

function collectAgentsSearchDirs(start: string, root: string): string[] {
  if (!isWithinScanRoot(start, root)) {
    return [start];
  }

  const dirs: string[] = [];
  let current = start;
  while (true) {
    dirs.push(current);
    if (current === root) {
      return dirs.reverse();
    }

    const parent = dirname(current);
    if (parent === current) {
      return dirs.reverse();
    }
    current = parent;
  }
}

function readAgentsMdFile(dir: string): AgentsMdFile | null {
  const filePath = join(dir, AGENT_FILENAME);
  if (!existsSync(filePath)) {
    return null;
  }
  return {
    path: filePath,
    content: readFileSync(filePath, "utf-8"),
  };
}

/**
 * Walk from `cwd` up to `scanRoot`, collecting AGENTS.md files.
 *
 * Also checks `globalAgentsDir` for global agent instructions when provided.
 * Results are ordered root-to-leaf (general → specific), with global
 * instructions first when present.
 *
 * @param cwd - Starting directory for the walk.
 * @param scanRoot - Uppermost directory to include in the walk.
 * @param globalAgentsDir - Optional directory for global agent instructions (e.g. `~/.agents/`).
 * @returns Array of {@link AgentsMdFile} records, ordered general → specific.
 */
export function discoverAgentsMd(
  cwd: string,
  scanRoot: string,
  globalAgentsDir?: string,
): AgentsMdFile[] {
  const root = canonicalizePath(scanRoot);
  const start = canonicalizePath(cwd);
  const files: AgentsMdFile[] = [];

  if (globalAgentsDir) {
    const globalFile = readAgentsMdFile(globalAgentsDir);
    if (globalFile) {
      files.push(globalFile);
    }
  }

  for (const dir of collectAgentsSearchDirs(start, root)) {
    const agentsFile = readAgentsMdFile(dir);
    if (agentsFile) {
      files.push(agentsFile);
    }
  }

  return files;
}

// ---------------------------------------------------------------------------
// Git line formatting
// ---------------------------------------------------------------------------

/**
 * Format a git state snapshot into a single-line string for the session footer.
 *
 * Fields are omitted when their values are zero. The git line format:
 * `Git: branch main | 3 staged, 1 modified, 2 untracked | +5 −2 vs origin/main`
 *
 * @param state - The git state to format.
 * @returns Formatted git status line.
 */
export function formatGitLine(state: GitState): string {
  const parts: string[] = [`Git: branch ${state.branch}`];

  // Working tree counts
  const counts: string[] = [];
  if (state.staged > 0) counts.push(`${state.staged} staged`);
  if (state.modified > 0) counts.push(`${state.modified} modified`);
  if (state.untracked > 0) counts.push(`${state.untracked} untracked`);
  if (counts.length > 0) parts.push(counts.join(", "));

  // Ahead/behind
  if (state.ahead > 0 || state.behind > 0) {
    const ab: string[] = [];
    if (state.ahead > 0) ab.push(`+${state.ahead}`);
    if (state.behind > 0) ab.push(`\u2212${state.behind}`);
    parts.push(`${ab.join(" ")} vs origin/${state.branch}`);
  }

  return parts.join(" | ");
}

// ---------------------------------------------------------------------------
// Base instructions
// ---------------------------------------------------------------------------

const BASE_INSTRUCTIONS = `You are mini-coder, a coding agent running in the user's terminal.

# Role

You are an autonomous, senior-level coding assistant. When the user gives a direction, proactively gather context, plan, implement, and verify without waiting for additional prompts at each step. Bias toward action: make reasonable assumptions and deliver working code rather than asking clarifying questions, unless you are genuinely blocked.

# Tools

You have these core tools:

- \`shell\` — run commands in the user's shell. Use this to explore the codebase (rg, find, ls, cat), run tests, build, git, and any other command. Prefer \`rg\` over \`grep\` for speed.
- \`edit\` — make exact-text replacements in files. Provide the file path, the exact text to find, and the replacement text. The old text must match exactly one location in the file. To create a new file, use an empty old text and the full file content as new text.

You may also have additional tools provided by plugins. Use them when they match the task.

Workflow: **inspect with shell → mutate with edit → verify with shell**.

# Code quality

- Conform to the codebase's existing conventions: patterns, naming, formatting, language idioms.
- Write correct, clear, minimal code. Don't over-engineer, don't add abstractions for hypothetical futures.
- Reuse before creating. Search for existing helpers before writing new ones.
- Tight error handling: no broad try/catch, no silent failures, no swallowed errors.
- Keep type safety. Avoid \`any\` casts. Use proper types and guards.
- Only add comments where the logic isn't self-evident.

# Editing discipline

- Read enough context before editing. Batch logical changes together rather than making many small edits.
- Never revert changes you didn't make unless explicitly asked.
- Never use destructive git commands (reset --hard, checkout --, clean -fd) unless the user requests it.
- Default to ASCII. Only use non-ASCII characters when the file already uses them or there's clear justification.

# Exploring the codebase

- Think first: before any tool call, decide all files and information you need.
- Batch reads: if you need multiple files, read them together in parallel rather than one at a time.
- Only make sequential calls when a later call genuinely depends on an earlier result.

# Communication

- Be concise. Friendly coding teammate tone.
- After making changes: lead with a quick explanation of what changed and why, then suggest logical next steps if any.
- Don't dump large file contents you've written — reference file paths.
- When suggesting multiple options, use numbered lists so the user can reply with a number.
- If asked for a review, focus on bugs, risks, regressions, and missing tests. Findings first, ordered by severity.

# Persistence

- Carry work through to completion within the current turn. Don't stop at analysis or partial fixes.
- If you encounter an error, diagnose and fix it rather than reporting it and stopping.
- Avoid excessive looping: if you're re-reading or re-editing the same files without progress, stop and ask the user.`;

// ---------------------------------------------------------------------------
// System prompt assembly
// ---------------------------------------------------------------------------

/**
 * Build the full system prompt.
 *
 * Assembly order:
 * 1. Base instructions (static)
 * 2. AGENTS.md content (project-specific)
 * 3. Skills catalog (XML)
 * 4. Plugin suffixes
 * 5. Session footer (date, CWD, git)
 *
 * @param opts - Prompt construction options.
 * @returns The assembled system prompt string.
 */
export function buildSystemPrompt(opts: BuildSystemPromptOpts): string {
  const sections: string[] = [BASE_INSTRUCTIONS];

  // 2. AGENTS.md content
  if (opts.agentsMd && opts.agentsMd.length > 0) {
    const agentsSection = [
      "\n# Project Context\n",
      "Project-specific instructions and guidelines:\n",
    ];
    for (const file of opts.agentsMd) {
      agentsSection.push(`## ${file.path}\n`);
      agentsSection.push(file.content);
      agentsSection.push("");
    }
    sections.push(agentsSection.join("\n"));
  }

  // 3. Skills catalog
  if (opts.skills && opts.skills.length > 0) {
    const catalog = buildSkillCatalog(opts.skills);
    if (catalog) sections.push(catalog);
  }

  // 4. Plugin suffixes
  if (opts.pluginSuffixes) {
    for (const suffix of opts.pluginSuffixes) {
      sections.push(suffix);
    }
  }

  // 5. Session footer
  const footer: string[] = [];
  footer.push(`Current date: ${opts.date}`);
  footer.push(`Current working directory: ${opts.cwd}`);
  if (opts.git) {
    footer.push(formatGitLine(opts.git));
  }
  sections.push(footer.join("\n"));

  return sections.join("\n");
}
