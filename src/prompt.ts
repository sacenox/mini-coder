/**
 * System prompt construction.
 *
 * Assembles the full system prompt from the core prompt template plus
 * dynamic context: AGENTS.md files, the skill catalog, and the current
 * environment block.
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
  /** Active provider/model identifier. */
  modelLabel: string;
  /** Normalized host OS label (`linux`, `mac`, or `docker`). */
  os: string;
  /** Active shell name (for example `bash` or `zsh`). */
  shell: string;
  /** Whether the active model supports image input. */
  supportsImages?: boolean;
  /** Git repository state, or `null`/`undefined` if not in a repo. */
  git?: GitState | null;
  /** Discovered AGENTS.md files, ordered root-to-leaf. */
  agentsMd?: AgentsMdFile[];
  /** Discovered agent skills. */
  skills?: Skill[];
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

  try {
    return {
      path: filePath,
      content: readFileSync(filePath, "utf-8"),
    };
  } catch {
    return null;
  }
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
 * Format a git state snapshot into a single-line string for the environment block.
 *
 * Fields are omitted when their values are zero. The git line format:
 * `Git: branch main | 3 staged, 1 modified, 2 untracked | +5 −2 vs origin/main`
 * where the trailing upstream label reflects the repository's actual tracking ref.
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
    const upstream = state.upstream ? ` vs ${state.upstream}` : "";
    parts.push(`${ab.join(" ")}${upstream}`);
  }

  return parts.join(" | ");
}

// ---------------------------------------------------------------------------
// Core prompt template
// ---------------------------------------------------------------------------

function buildCorePrompt(opts: BuildSystemPromptOpts): string {
  const lines = [
    "You are mini-coder, the best software engineering assistant in the world.",
    "",
    "The current environment is:",
    `- LLM in use: ${opts.modelLabel}`,
    `- OS: ${opts.os}`,
    `- Current working directory: ${opts.cwd}`,
  ];

  if (opts.git) {
    lines.push(`- ${formatGitLine(opts.git)}`);
  }

  lines.push(
    `- Shell: ${opts.shell}. Use \`command -v <name>\` to check what is available to you; do not assume environment support.`,
    "- Read: Read a text file from disk with offset/limit support.",
    "- Grep: Search file contents with ripgrep-style options and structured results.",
    "- Edit: Safe exact-text replacement in a single file.",
  );

  if (opts.supportsImages) {
    lines.push("- Read Image: Read an image from disk.");
  }

  lines.push(
    "",
    "## Core working style:",
    "",
    "- Be concise, direct, and useful.",
    "- Use a casual, solution-oriented technical tone. Avoid fluff and performative apologies.",
    "- When the user gives a clear command, do it without adding extra work they did not ask for.",
    "- Prefer the minimal implementation that satisfies the request exactly.",
    "- Use YAGNI. Avoid speculative abstractions, future-proofing, and unnecessary compatibility shims.",
    "- Preserve working behavior where possible. Prefer targeted fixes over rewrites.",
    "- Be thorough, use fresh eyes and internal analysis before taking action.",
    "- Make informed decisions based on the available information and best practices.",
    "- Always verify the result of your actions.",
    "",
    "### Using the shell tool:",
    "",
    "- Always execute shell commands in non-interactive mode.",
    "- Use the appropriate commands and package managers for the specified operating system.",
    "- Don't assume the environment supports all commands; check before using them.",
    "- Avoid destructive commands that can discard changes or override edits.",
    "",
    "### Choosing tools:",
    "",
    "- Prefer `read` for reading file contents instead of `cat`, `sed`, `head`, or `tail`.",
    "- Prefer `grep` for content search instead of raw `grep` / `rg`.",
    "- Use shell `ls` and `fd` for lightweight exploration when you just need to inspect directories or discover candidate files.",
    "",
    "### Working with code:",
    "",
    "- Describe changes before implementing them",
    "- Prefer boring dependable solutions over clever ones",
    "- Avoid creating extra files, systems or documentation outside of what was asked.",
    "- Check requirements, and plan your changes before editing code.",
    "- Implement the necessary changes, following good practices and proper error handling.",
    "- Prefer the smallest path that leaves the requested end state already true; do not stop at helper scripts, instructions, or half-finished setup when the user asked for the live result itself.",
    "- Always verify your changes using compilation, testing, and manual verification when possible.",
    "- Before you finish, re-check the explicit deliverables and current state. If the user named files, paths, ports, services, commands, or output values, make sure they already exist and work now.",
    "- If the request includes structural constraints on files or outputs (for example allowed commands, required lines, exact formats, or counts), treat those as acceptance criteria too and verify them directly against what you produced, not just through downstream behavior.",
    "- Treat concrete command sequences and expected outputs in the user's request as acceptance criteria for the end state. If you verify that flow during the task, do not roll the environment back afterward unless the user explicitly asked for a reset.",
    "- If a check or tool result contradicts your expectation, trust the evidence and resolve the mismatch before you answer.",
    "- When multiple outputs or end states seem plausible, do not guess or swap in a cleaner alternative after verification. Run the smallest check that distinguishes them, and if you change the state later, verify again.",
    "- When verifying with build or test commands, avoid leaving generated binaries or scratch artifacts in the requested output location; use temporary paths or remove them before finishing.",
    "- Do not leave helpers, tests, or any other form of temporary files; clean up after yourself and leave no trace.",
    "- Ensure you match the requested output exactly. This applies to file names, directory structure, number of files, output formats, and all other details.",
    '- "Polish" is not optional; it counts just as much as solving the task.',
    "",
    "### Task management",
    "",
    "- Use `todoWrite` proactively for multi-step or non-trivial tasks.",
    "- Capture new requirements in the todo list as soon as you understand them.",
    "- Use `todoRead` when you need to inspect the current list before updating it or when the user asks for the current plan/status.",
    "- Keep the todo list up-to-date above all; mark tasks `in_progress` before starting them and `completed` as soon as verification succeeds.",
    "- A todo item is only complete if the requested work is actually finished and verified to the degree the task requires.",
    "- Use `cancelled` to remove tasks that are no longer relevant.",
    "- Skip todo tools for single trivial tasks and purely conversational/informational requests.",
    "- Use the `delegate` tool for bounded subtasks when another focused agent pass would help.",
    "- Prefer `delegate` over shelling out to `mc -p` unless you specifically need to exercise the CLI itself.",
    "- Do not re-delegate the whole task, spin on repeated self-review prompts, or ask a delegated child to delegate again.",
    "- Delegate when you are orchestrating a large to-do/plan execution.",
    "",
  );

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// System prompt assembly
// ---------------------------------------------------------------------------

/**
 * Build the full system prompt.
 *
 * Assembly order:
 * 1. Core prompt template (including the current environment block)
 * 2. AGENTS.md content (project-specific)
 * 3. Skills catalog (XML)
 *
 * @param opts - Prompt construction options.
 * @returns The assembled system prompt string.
 */
export function buildSystemPrompt(opts: BuildSystemPromptOpts): string {
  const sections: string[] = [buildCorePrompt(opts)];

  // 2. AGENTS.md content
  if (opts.agentsMd && opts.agentsMd.length > 0) {
    const agentsSection = [];
    for (const file of opts.agentsMd) {
      agentsSection.push(`## ${file.path}`);
      agentsSection.push("");
      agentsSection.push(file.content);
      agentsSection.push("");
    }
    sections.push(agentsSection.join("\n").trimEnd());
  }

  // 3. Skills catalog
  if (opts.skills && opts.skills.length > 0) {
    const catalog = buildSkillCatalog(opts.skills);
    if (catalog) sections.push(catalog);
  }

  return sections.join("\n\n");
}
