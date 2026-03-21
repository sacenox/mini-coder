import {
  closeSync,
  existsSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  statSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import * as c from "yoctocolors";
import { parseFrontmatter } from "./frontmatter.ts";
import { G, writeln } from "./output.ts";

export interface SkillMeta {
  name: string;
  description: string;
  source: "global" | "local";
  rootPath: string;
  filePath: string;
  context?: "fork";
}

export interface LoadedSkillContent {
  name: string;
  content: string;
  source: "global" | "local";
  skillDir: string;
  resources: string[];
}

const MAX_FRONTMATTER_BYTES = 64 * 1024;
const SKILL_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_SKILL_NAME_LENGTH = 64;
const warnedInvalidSkills = new Set<string>();
const warnedSkillIssues = new Set<string>();

type SkillCandidate = {
  folderName: string;
  filePath: string;
  rootPath: string;
  source: "global" | "local";
  frontmatter?: SkillFrontmatter;
};

type SkillFrontmatter = {
  name?: string;
  description?: string;
  context?: string;
};

function parseSkillFrontmatter(filePath: string): SkillFrontmatter {
  let fd: number | null = null;
  try {
    fd = openSync(filePath, "r");
    const chunk = Buffer.allocUnsafe(MAX_FRONTMATTER_BYTES);
    const bytesRead = readSync(fd, chunk, 0, MAX_FRONTMATTER_BYTES, 0);
    const text = chunk.toString("utf8", 0, bytesRead);
    const { meta } = parseFrontmatter(text);
    const result: SkillFrontmatter = {};
    if (meta.name) result.name = meta.name;
    if (meta.description) result.description = meta.description;
    if (meta.context) result.context = meta.context;
    return result;
  } catch {
    return {};
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

function getCandidateFrontmatter(candidate: SkillCandidate): SkillFrontmatter {
  if (!candidate.frontmatter) {
    candidate.frontmatter = parseSkillFrontmatter(candidate.filePath);
  }
  return candidate.frontmatter;
}

function candidateConflictName(candidate: SkillCandidate): string {
  return (
    getCandidateFrontmatter(candidate).name?.trim() || candidate.folderName
  );
}

function findGitBoundary(cwd: string): string | null {
  let current = resolve(cwd);
  while (true) {
    if (existsSync(join(current, ".git"))) return current;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function localSearchRoots(cwd: string): string[] {
  const start = resolve(cwd);
  const stop = findGitBoundary(start);
  if (!stop) return [start];
  const roots: string[] = [];
  let current = start;
  while (true) {
    roots.push(current);
    if (current === stop) break;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return roots;
}

function listSkillCandidates(
  skillsDir: string,
  source: "global" | "local",
  rootPath: string,
): SkillCandidate[] {
  if (!existsSync(skillsDir)) return [];
  let entries: string[];
  try {
    entries = readdirSync(skillsDir).sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
  const candidates: SkillCandidate[] = [];
  for (const entry of entries) {
    const skillDir = join(skillsDir, entry);
    try {
      if (!statSync(skillDir).isDirectory()) continue;
    } catch {
      continue;
    }
    const filePath = join(skillDir, "SKILL.md");
    if (!existsSync(filePath)) continue;
    candidates.push({
      folderName: entry,
      filePath,
      rootPath,
      source,
    });
  }
  return candidates;
}

function warnInvalidSkill(filePath: string, reason: string): void {
  const key = `${filePath}:${reason}`;
  if (warnedInvalidSkills.has(key)) return;
  warnedInvalidSkills.add(key);
  writeln(`${G.warn} skipping invalid skill ${filePath}: ${reason}`);
}

function warnSkillIssue(filePath: string, reason: string): void {
  const key = `${filePath}:${reason}`;
  if (warnedSkillIssues.has(key)) return;
  warnedSkillIssues.add(key);
  writeln(`${G.warn} skill ${filePath}: ${reason}`);
}

function warnConventionConflicts(
  kind: "skills",
  scope: "global" | "local",
  agentsNames: Iterable<string>,
  claudeNames: Iterable<string>,
): void {
  const agents = new Set(agentsNames);
  const claude = new Set(claudeNames);
  const conflicts: string[] = [];

  for (const name of agents) {
    if (claude.has(name)) conflicts.push(name);
  }

  if (conflicts.length === 0) return;

  conflicts.sort((a, b) => a.localeCompare(b));
  const list = conflicts.map((n) => c.cyan(n)).join(c.dim(", "));
  writeln(
    `${G.warn} conflicting ${kind} in ${scope} .agents and .claude: ${list} ${c.dim("— using .agents version")}`,
  );
}

function validateSkill(candidate: SkillCandidate): SkillMeta | null {
  const meta = getCandidateFrontmatter(candidate);
  const name = meta.name?.trim();
  const description = meta.description?.trim();

  if (!name) {
    warnInvalidSkill(
      candidate.filePath,
      "frontmatter field `name` is required",
    );
    return null;
  }
  if (!description) {
    warnInvalidSkill(
      candidate.filePath,
      "frontmatter field `description` is required",
    );
    return null;
  }
  if (name.length > MAX_SKILL_NAME_LENGTH) {
    warnSkillIssue(
      candidate.filePath,
      `name exceeds ${MAX_SKILL_NAME_LENGTH} characters`,
    );
  }
  if (!SKILL_NAME_RE.test(name)) {
    warnSkillIssue(
      candidate.filePath,
      "name does not match lowercase alnum + hyphen format",
    );
  }

  return {
    name,
    description,
    source: candidate.source,
    rootPath: candidate.rootPath,
    filePath: candidate.filePath,
    ...(meta.context === "fork" && { context: "fork" as const }),
  };
}

function allSkillCandidates(cwd: string, homeDir?: string): SkillCandidate[] {
  const home = homeDir ?? homedir();
  const localRootsNearToFar = localSearchRoots(cwd);
  const ordered: SkillCandidate[] = [];

  const globalClaude = listSkillCandidates(
    join(home, ".claude", "skills"),
    "global",
    home,
  );
  const globalAgents = listSkillCandidates(
    join(home, ".agents", "skills"),
    "global",
    home,
  );
  warnConventionConflicts(
    "skills",
    "global",
    globalAgents.map((skill) => candidateConflictName(skill)),
    globalClaude.map((skill) => candidateConflictName(skill)),
  );
  ordered.push(...globalClaude, ...globalAgents);

  for (const root of [...localRootsNearToFar].reverse()) {
    const localClaude = listSkillCandidates(
      join(root, ".claude", "skills"),
      "local",
      root,
    );
    const localAgents = listSkillCandidates(
      join(root, ".agents", "skills"),
      "local",
      root,
    );
    warnConventionConflicts(
      "skills",
      "local",
      localAgents.map((skill) => candidateConflictName(skill)),
      localClaude.map((skill) => candidateConflictName(skill)),
    );
    ordered.push(...localClaude, ...localAgents);
  }

  return ordered;
}

export function loadSkillsIndex(
  cwd: string,
  homeDir?: string,
): Map<string, SkillMeta> {
  const index = new Map<string, SkillMeta>();
  for (const candidate of allSkillCandidates(cwd, homeDir)) {
    const skill = validateSkill(candidate);
    if (!skill) continue;
    index.set(skill.name, skill);
  }
  return index;
}

const MAX_RESOURCE_LISTING = 50;

function listSkillResources(skillDir: string): string[] {
  const resources: string[] = [];
  function walk(dir: string, prefix: string): void {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (resources.length >= MAX_RESOURCE_LISTING) return;
      if (entry === "SKILL.md") continue;
      const full = join(dir, entry);
      const rel = prefix ? `${prefix}/${entry}` : entry;
      try {
        if (statSync(full).isDirectory()) {
          walk(full, rel);
        } else {
          resources.push(rel);
        }
      } catch {}
    }
  }
  walk(skillDir, "");
  return resources;
}

export function loadSkillContentFromMeta(
  skill: SkillMeta,
): LoadedSkillContent | null {
  try {
    const content = readFileSync(skill.filePath, "utf-8");
    const skillDir = dirname(skill.filePath);
    return {
      name: skill.name,
      content,
      source: skill.source,
      skillDir,
      resources: listSkillResources(skillDir),
    };
  } catch {
    return null;
  }
}

export function loadSkillContent(
  name: string,
  cwd: string,
  homeDir?: string,
): LoadedSkillContent | null {
  const skill = loadSkillsIndex(cwd, homeDir).get(name);
  if (!skill) return null;
  return loadSkillContentFromMeta(skill);
}
