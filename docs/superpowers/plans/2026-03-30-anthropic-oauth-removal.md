# Anthropic OAuth Removal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove Claude Code subscription OAuth support without affecting Anthropic API-key access or Zen Claude models.

**Architecture:** Delete the Anthropic OAuth provider registration and stop consulting Anthropic OAuth state in discovery/model-info paths. Preserve all direct `ANTHROPIC_API_KEY` behavior and Anthropic-family handling needed by Zen and direct API use.

**Tech Stack:** Bun, TypeScript, bun:test, SQLite-backed auth storage, AI SDK providers.

---

### Task 1: Track the work and lock the user-facing contract

**Files:**

- Modify: `TODO.md`
- Reference: `docs/superpowers/specs/2026-03-30-anthropic-oauth-removal-design.md`

- [ ] **Step 1: Update TODO.md with active work item**
- [ ] **Step 2: Keep TODO.md current as tasks complete**

### Task 2: Write failing tests for Anthropic OAuth removal

**Files:**

- Modify: `src/llm-api/providers-resolve.test.ts`
- Modify: `src/llm-api/model-info.test.ts`
- Create: `src/session/oauth/auth-storage.test.ts`

- [ ] **Step 1: Add a test asserting OAuth providers list only OpenAI**
- [ ] **Step 2: Add tests asserting Anthropic discovery requires `ANTHROPIC_API_KEY`**
- [ ] **Step 3: Run focused tests to verify they fail for the expected reason**

### Task 3: Remove Anthropic OAuth registration and discovery usage

**Files:**

- Delete: `src/session/oauth/anthropic.ts`
- Modify: `src/session/oauth/auth-storage.ts`
- Modify: `src/llm-api/providers.ts`
- Modify: `src/llm-api/model-info.ts`
- Modify: `src/llm-api/model-info-fetch.ts`

- [ ] **Step 1: Remove the Anthropic OAuth provider from auth storage**
- [ ] **Step 2: Remove Anthropic OAuth-based provider discovery/autodiscovery**
- [ ] **Step 3: Remove Anthropic OAuth-based model list fetching**
- [ ] **Step 4: Run the focused tests and make them pass**

### Task 4: Update CLI/docs and finish verification

**Files:**

- Modify: `src/cli/commands-help.ts`
- Modify: `docs/mini-coder.1.md`
- Modify: `TODO.md`

- [ ] **Step 1: Remove Anthropic OAuth mentions from help/manpage**
- [ ] **Step 2: Run formatting if needed**
- [ ] **Step 3: Run focused tests, then broader verification commands**
- [ ] **Step 4: Clear the completed TODO item**
