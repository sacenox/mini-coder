# Implementation Plan: Reasoning Display Support

## Current State Analysis

### What Already Exists:

| Component | Current State |
|-----------|---------------|
| `ReasoningDeltaEvent` in `types.ts` | ✅ Event type defined |
| `runTurn()` in `turn.ts` | ✅ Generates `reasoning-delta` events from AI SDK streams |
| `renderTurn()` in `stream-render.ts` | ✅ Handles events, shows "Thinking..." header, renders dimmed text |
| `preferred_thinking_effort` | ✅ Controls how much reasoning the model does (separate concern) |

### What's Missing:

| Component | Missing |
|-------------|---------|
| User setting | No toggle to show/hide reasoning output |
| `accumulatedText` | Reasoning not accumulated (unlike regular text) |
| Message persistence | Reasoning not stored in message history |
| Headless reporter | Ignores reasoning events |
| Status bar | No indicator for reasoning display mode |

---

## Implementation Plan

### Phase 1: Add Settings Infrastructure
**Files: `src/session/db/settings-repo.ts`**

Add `preferred_show_reasoning` setting (boolean stored as "true"/"false" string):
- `getShowReasoning(): boolean` - returns true by default
- `setShowReasoning(show: boolean): void`

### Phase 2: Update Reporter Interface & Types
**Files: `src/agent/reporter.ts`, `src/llm-api/types.ts`**

1. Add `showReasoning?: boolean` to `StatusBarData` interface
2. Add `reasoningText` to `TurnResult` so reasoning can be accumulated and returned

### Phase 3: Update Stream Rendering
**Files: `src/cli/stream-render.ts`**

1. Accept `showReasoning` option in `renderTurn()`
2. When `showReasoning` is false: consume reasoning events but don't render them
3. Accumulate reasoning text into a separate buffer (not mixed with `accumulatedText`)
4. Return accumulated reasoning in `TurnResult`

### Phase 4: Update Status Bar
**Files: `src/cli/status-bar.ts`**

Add reasoning indicator (e.g., "🤔" or "thinking") when `showReasoning` is true

### Phase 5: Update Command Context & CLI Commands
**Files: `src/cli/commands.ts`, `src/agent/session-runner.ts`, `src/index.ts`**

1. Add `showReasoning` to `CommandContext`
2. Add `/reasoning` command to toggle (on|off)
3. Load/save preference from settings repo
4. Pass setting through to `SessionRunner` and reporter

### Phase 6: Update Output Reporter & Headless Reporter
**Files: `src/cli/output-reporter.ts`, `src/cli/headless-reporter.ts`**

1. Accept and forward `showReasoning` option
2. Headless reporter: still consume reasoning events (for accumulation) but never render

### Phase 7: Agent Integration
**Files: `src/agent/agent.ts`**

1. Load `getShowReasoning()` preference
2. Pass to `CommandContext` and `SessionRunner`
3. Update status bar calls to include reasoning flag

### Phase 8: Help & Documentation
**Files: `src/cli/commands.ts`**

Add `/reasoning` to help text

---

## Files to Modify (in dependency order):

1. `src/session/db/settings-repo.ts` - Add new setting functions
2. `src/llm-api/types.ts` - Add reasoning to TurnResult (if needed)
3. `src/agent/reporter.ts` - Update StatusBarData
4. `src/cli/stream-render.ts` - Add showReasoning option
5. `src/cli/status-bar.ts` - Add reasoning indicator
6. `src/cli/output-reporter.ts` - Forward option
7. `src/cli/headless-reporter.ts` - Handle reasoning events
8. `src/cli/commands.ts` - Add /reasoning command
9. `src/agent/session-runner.ts` - Accept and pass through setting
10. `src/agent/agent.ts` - Load preference, wire up
11. `src/index.ts` - Load preference on startup
12. `src/session/db/index.ts` - Export new functions

---

## Design Decisions

1. **Separate from thinking effort**: The existing `thinkingEffort` controls how much reasoning the model *produces*. The new `showReasoning` controls whether we *display* it. These are orthogonal concerns.

2. **Default to true**: Users who have models with reasoning capability expect to see it. They can opt out.

3. **Accumulate separately, don't persist**: Reasoning text should be accumulated for display purposes only. It must **NOT** be added to the message history that gets sent back to the model on subsequent turns - this would bloat the context window unnecessarily. The reasoning is ephemeral UI feedback, not part of the conversation state.

4. **Headless mode**: Even when headless, we consume reasoning events to properly track state, but never render them (headless is non-interactive). The accumulated reasoning is discarded, not stored.

## Additional Considerations

### Context Window Bloat Prevention

The reasoning output can be substantial (especially with high thinking effort). We must ensure:

- `reasoningText` is **never** added to `coreHistory` or `session.messages`
- `reasoningText` is **never** returned in `TurnResult.messages` or `TurnCompleteEvent.messages`
- The reasoning is for UI display only and is discarded after the turn completes
- Abort message building (`buildAbortMessages`) should not include reasoning text