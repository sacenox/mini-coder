# Skills Auto-Discovery + Progressive Disclosure — Implementation Plan

## Goal
Implement skills behavior aligned with Claude Code/OpenCode expectations:
- Auto-discovered skills from supported directories
- Progressive disclosure (metadata first, full content on demand)
- Agent-accessible skill loading at runtime
- Backward-compatible explicit `@skill` usage

## Scope
In scope:
- Skill discovery/indexing
- Runtime skill loading mechanism/tooling
- Prompt/context integration changes
- Validation rules and conflict handling
- Tests and docs updates

Out of scope (for this iteration):
- Remote skill registries / marketplace install flows
- Full plugin packaging workflows
- New UI beyond existing `/help` and completion paths

---

## Phase 1 — Data model split (metadata index vs full content)

### Changes
1. Introduce explicit types:
   - `SkillMeta` (name, description, source, root path, file path)
   - `SkillRecord` / loader output that can resolve full content lazily
2. Refactor `src/cli/skills.ts`:
   - `loadSkillsIndex(cwd, homeDir?) => Map<string, SkillMeta>`
   - `loadSkillContent(name, cwd, homeDir?) => { name, content, source } | null`
3. Keep existing `loadSkills` temporarily as compatibility shim, then migrate callsites.

### Acceptance criteria
- Reading skill metadata does not read all `SKILL.md` bodies into memory.
- Existing command/help/completion behavior still works.

---

## Phase 2 — Discovery parity (auto-discovery + walk-up)

### Changes
1. Extend discovery in `src/cli/load-markdown-configs.ts`:
   - Walk upward from `cwd` to git worktree root for local dirs.
   - Collect from each level:
     - `.agents/skills/*/SKILL.md`
     - `.claude/skills/*/SKILL.md`
   - Continue loading global dirs:
     - `~/.agents/skills/*/SKILL.md`
     - `~/.claude/skills/*/SKILL.md`
2. Define deterministic precedence:
   - Nearest local path wins over farther ancestor
   - Local wins over global
   - At same scope/path level, `.agents` wins over `.claude`
3. Retain conflict warnings where appropriate.

### Acceptance criteria
- Skills in parent directories are discoverable.
- Precedence is deterministic and covered by tests.

---

## Phase 3 — Progressive disclosure runtime path

### Changes
1. Add agent-facing skill loader tool (or equivalent internal tool contract) in `src/tools/`:
   - `listSkills` (metadata only)
   - `readSkill` / `loadSkill` (full `SKILL.md` for a single skill)
2. Expose available skill metadata to the model with minimal token footprint.
3. Ensure full skill content is loaded only when:
   - the model explicitly requests it via tool, or
   - the user explicitly references `@skill-name`.
4. Route `@skill-name` expansion through same resolver used by runtime loader.

### Acceptance criteria
- Normal turns do not include all skill bodies.
- Skill body appears only after explicit load trigger.
- `@skill-name` remains functional.

---

## Phase 4 — Validation + compatibility policy

### Changes
1. Add validation for skill frontmatter:
   - `name` required
   - `description` required
   - name format constraints (lowercase alnum + hyphen, length bounds)
2. Validation policy:
   - Invalid skills are skipped with clear warnings.
   - Unknown frontmatter fields are tolerated.
3. Optional: introduce strict mode flag if needed for incremental rollout.

### Acceptance criteria
- Invalid skills do not crash loading.
- Validation behavior is deterministic and tested.

---

## Phase 5 — UX and docs alignment

### Changes
1. Update CLI help output to reflect skill auto-discovery and on-demand loading semantics.
2. Update docs (`docs/skills.md`) to describe:
   - discovery locations + walk-up behavior
   - precedence rules
   - progressive disclosure
   - validation constraints
3. Keep examples for explicit `@skill` usage and tab completion.

### Acceptance criteria
- Docs match real runtime behavior.
- `/help` and completion output stay accurate.

---

## Testing Plan

Add/extend tests in:
- `src/cli/skills.test.ts`
- `src/cli/input.test.ts` (completion and visibility)
- new/updated tests for loader precedence and walk-up behavior
- tool tests for `listSkills`/`readSkill`

Required scenarios:
1. Walk-up discovery from nested cwd.
2. Precedence matrix (nearest local > ancestor local > global; `.agents` > `.claude`).
3. Metadata-only listing does not require full body reads.
4. On-demand content load returns exact raw `SKILL.md`.
5. `@skill` expansion remains correct and unified with loader.
6. Invalid skill frontmatter handling.

Verification command:
- `bun run jscpd && bun run knip && bun run typecheck && bun run format && bun run lint && bun run test`

---

## Rollout Strategy

1. Land Phases 1–2 behind compatibility-preserving interfaces.
2. Land Phase 3 with both explicit (`@skill`) and runtime tool path enabled.
3. Enable strict validation policy (Phase 4) once tests and docs are complete.
4. Final docs/help cleanup and full QA pass.

---

## Risks and Mitigations

- **Risk:** Behavior drift for users relying on permissive frontmatter.
  - **Mitigation:** Start with warning-based skipping and clear error messages.
- **Risk:** Token/context regression from accidental eager loading.
  - **Mitigation:** Add tests asserting no eager full-body skill injection.
- **Risk:** Discovery order confusion in monorepos.
  - **Mitigation:** Document precedence and cover with explicit tests.

---

## Done Definition

Complete when:
- Skills are auto-discovered with walk-up + global support.
- Model receives metadata catalog, not full bodies by default.
- Full skill content is loaded only on demand.
- `@skill` works through unified loader path.
- Validation, tests, and docs are all aligned and passing.