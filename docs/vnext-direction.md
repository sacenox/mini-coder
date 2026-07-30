# mini-coder vNext direction

This document captures the product direction and path forward derived from the
user's brain dump in [`TODO.md`](../TODO.md), discussion about it, repository
history, the archived mini-coder implementations, Feather, Pi extensions, and
OpenCode usage.

It records intent, decisions, and decision gates. It is deliberately not a
complete implementation specification. Code, tests, focused acceptance journeys,
and short decision records should remain the detailed sources of truth as vNext
evolves.

## Product statement

mini-coder should be a transparent, extensible terminal coding agent with an
excellent input experience, a small auditable core, first-class local and hosted
model support, and sessions that remain intelligible and owned by the user.

Local and hosted models are peers. Local support should not be a separate or
reduced edition, while hosted-provider support should not force local users
through verbose cloud-oriented configuration.

## Product character

mini-coder should combine:

- Pi's small agent core, minimal system prompt, versatility, and extension-first
  philosophy.
- OpenCode's attention to terminal UX and presentation.
- Locally owned, readable sessions and transparent agent behavior.
- First-class local-model onboarding and context management.
- A dependency and maintenance surface small enough for a hobby project to
  understand and sustain.

Transparency does not require showing every event at full volume. The default UI
may summarize information to remain readable, but model requests, reasoning made
available by the provider, tool activity, compaction, delegation, errors, and
other meaningful work must be visible or directly inspectable. The application
must not replace concrete activity with generic messages such as "a subagent is
doing things."

## Lessons from previous implementations

The repository history contains several useful experiments:

1. The original implementation owned substantial provider and terminal behavior.
   It became expensive to maintain alongside the actual agent.
2. The 0.5 implementation adopted pi-ai and cel-tui, but accumulated a broad
   feature set and a detailed specification that was costly to keep synchronized
   with the code.
3. The current prototype recovered a small and understandable core, but removed
   too much product structure around observability, editing, extensibility,
   provider-neutral presentation, and durable session semantics.
4. Feather demonstrated useful local-provider, append-only session, and terminal
   ideas. It also showed that owning providers, tools, sessions, context, and the
   TUI while avoiding runtime dependencies creates a large maintenance surface of
   its own.

vNext should therefore not begin as another comprehensive spec-driven rewrite,
and it should not grow by attaching features directly to the current mutable TUI
state. It should proceed through measured decisions and narrow vertical slices.

## Confirmed decisions

### Model support

Local and hosted providers are equal product paths.

The local path should eventually provide straightforward endpoint discovery,
health reporting, model discovery, capability and context-window information,
and useful defaults for at least Ollama and llama.cpp. It should not require users
to reproduce an entire provider model record for a normal setup.

### Initial extension surface

The first extension API should focus on three demonstrated needs:

- tools,
- commands,
- custom agents.

Provider plugins, arbitrary lifecycle hooks, and custom TUI components should not
be included until a concrete extension requires them.

Extensions are trusted in-process code. mini-coder should state that plainly
instead of presenting an application-level plugin permission system as a
security boundary.

### Initial editor scope

The first editor should target ordinary notepad-level input rather than Vim,
Emacs, or readline parity.

The initial scope is:

- multiline insertion and deletion,
- predictable cursor movement across lines,
- normal selection and clipboard-oriented editing supported by the chosen TUI
  and terminal,
- reliable typing, deletion, newline handling, and large paste handling,
- draft preservation when opening and closing UI controls,
- a clear way to attach text files and supported images.

The initial scope explicitly excludes:

- Vim or Emacs modes,
- undo and redo,
- persistent input history,
- prompt history search,
- general filesystem path completion.

File attachments are required even though general path completion is deferred.
The attachment interaction can be purpose-built rather than making a complete
path-completion system a prerequisite.

### Diagnostics and telemetry

vNext should provide local diagnostics for development and dogfooding. No usage,
prompt, error, or performance telemetry should be sent remotely.

Local diagnostics should make startup, provider requests, agent phases, tool
execution, rendering, cancellation, and failures traceable. Secrets and prompt or
tool content should be excluded or redacted by default, with more detailed local
logging enabled explicitly when needed.

Future opt-in user telemetry is not ruled out. The initial implementation should
keep diagnostic event production separate from its local storage or display, but
should not build a generalized telemetry platform before another sink exists.

### Repository and release strategy

The current main branch should be preserved in a new archive branch before vNext
work changes it substantially.

After that archive exists, vNext may replace the current implementation on main
or reuse useful pieces. This should be decided from evidence rather than assuming
that either a clean rewrite or incremental migration is inherently better.

vNext will not be published to npm until it provides a better overall experience
than the currently published version. The archived version remains the behavioral
and benchmark baseline during development.

## Architectural direction

These are starting constraints to validate through the first vertical slice, not
a prescribed file tree.

### Owned application model

pi-ai remains the initial provider implementation, but mini-coder should translate
its messages and stream events once at a narrow adapter boundary.

The rest of the application should consume small mini-coder-owned values for:

- readable user and assistant content,
- reasoning content when a provider exposes it,
- tool calls and arguments,
- tool progress and results,
- usage,
- model and provider identity,
- stop reasons, cancellation, and errors.

Presentation code should not repeatedly inspect pi-ai content unions. Provider
metadata may be retained as an optional sidecar for same-provider continuation,
but it must not be the only carrier of session meaning.

A separate modular provider library should remain a research topic until concrete
provider divergence demonstrates that pi-ai plus a narrow adapter cannot satisfy
mini-coder. vNext should not depend on solving a universal provider abstraction
first.

### User-owned sessions

The local session record should be canonical, readable, versioned, and append-only.
It should retain enough normalized information for another model or provider to
understand and continue the work without dereferencing provider-owned state.

Durable records should include meaningful completed events such as messages, tool
calls and results, cancellations, compaction summaries, model changes, and
subagent lineage. High-frequency streaming deltas can remain transient.
Provider-specific opaque data may be preserved as optional metadata, never as the
sole readable record.

This follows the session-portability principle that local applications should own
an intelligible transcript:
<https://earendil.com/posts/session-portability/>.

### Distinct state boundaries

The application should distinguish:

1. **Session history** — the durable semantic record of what happened.
2. **Live run state** — waiting, streaming, running a tool, cancelled, or failed.
3. **Diagnostic events** — timings and implementation details used to investigate
   failures and stalls.

The TUI and headless modes should be projections of the same application events.
Neither should own agent semantics or provider message conversion.

### Transparent custom agents

A custom agent should be a configuration over the same agent runtime, with at
least:

- a name and description,
- model and reasoning effort,
- its own prompt,
- an allowed tool set.

The main agent can invoke it through one explicit delegation tool. A delegated run
should have isolated context and durable lineage. The UI should show the selected
agent and model, current action, elapsed state, final result, and a directly
inspectable child transcript.

The core should not automatically delegate work or hide child prompts and actions.
The existing Exa and adversary extensions are useful acceptance cases for the
extension API: one ordinary streaming tool and one tool backed by an isolated
agent.

### TypeScript and runtime validation

Bun and TypeScript remain the preferred implementation environment for vNext.
Changing language would discard too much validated provider, extension, and TUI
work without addressing the main product problems.

TypeScript types should remain local and plain. Runtime schemas should be used at
actual trust boundaries such as settings, session records, extension manifests,
provider payloads, and tool arguments. A validation dependency should be selected
through a small trial against real boundary data, based on readable code, useful
errors, package maturity, dependency surface, and JSON Schema interoperability.
It should not spread schema-derived types through every internal operation.

## TUI and conversation model decision spike

Both major conversation models remain open:

### Full-screen conversation

Potential benefits:

- completed and historical rows can be updated or expanded in place,
- overlays and rich navigation fit naturally,
- the application controls a consistent polished layout,
- tool calls and subagents can retain live structured rows.

Costs to measure:

- long histories require correct virtualization or another bounded rendering
  strategy,
- terminal-native selection and scrollback may be harder,
- resizing, alternate-screen recovery, and rendering bugs become application
  responsibilities,
- the UI can obscure activity if its state and event handling stall.

### Append-only conversation with a bounded live region

Potential benefits:

- the terminal emulator owns durable scrollback, selection, and much scrolling,
- completed output does not need to be continuously rerendered,
- memory and rendering work can remain bounded,
- terminal history remains available naturally after the application exits.

Costs to measure:

- committed rows cannot be freely updated in place,
- in-flight tool and assistant output need a carefully bounded live area,
- overlays and navigation may interact awkwardly with scrollback,
- expanded details may need to be appended rather than toggled in place.

### Spike method

The decision should not be made from library preference or screenshots. Build
small disposable prototypes that replay the same deterministic recorded agent
events and provide the same editor and attachment interaction.

The leading framework candidates are cel-tui and OpenTUI. OpenTUI deserves direct
evaluation because it powers OpenCode and provides Bun/TypeScript bindings, input,
textarea, scrolling, selection, code, and diff primitives:

- <https://github.com/anomalyco/opentui>
- <https://opentui.com/>

Adopting OpenTUI would not by itself reproduce OpenCode's UX. Its native runtime,
prebuilt artifacts, development pace, framework bindings, and supply-chain impact
must be evaluated. Retaining cel-tui must include the maintenance cost of any
library changes and the current specification/documentation workflow.

Do not build every framework and conversation-model combination. Start with the
most natural implementation of each conversation model, use the same replay and
acceptance cases, and investigate a second implementation only where framework
behavior prevents a fair comparison.

### Measurements

Use a fixed corpus containing long text, reasoning, edits, large and rapidly
streaming tool output, failures, cancellations, images or attachment metadata,
and nested agent activity.

Measure:

- startup time,
- idle CPU usage,
- streaming CPU usage and render latency,
- memory use as history grows,
- terminal bytes written,
- responsiveness with a large history,
- scroll behavior and stick-to-bottom behavior,
- terminal-native text selection and copying,
- resize behavior,
- large paste and multiline editing behavior,
- overlay and draft preservation,
- terminal restoration after normal exit, cancellation, and injected failure,
- implementation size and conceptual complexity,
- required upstream or local TUI-framework changes,
- manual readability and sense of control during real use.

For a full-screen design, the large-history test must exercise virtualization or
an equivalent bounded strategy. For an append-only design, it must demonstrate
that the live region remains correct while the terminal owns a large committed
history.

Record the result in a short decision note containing evidence, rejected options,
and known costs. Spike code should not become production architecture merely
because it exists.

## Context management for local models

Small local context windows make context management a core behavior rather than a
late optimization.

The initial policy should progress visibly through:

1. bounded tool output with explicit omission metadata,
2. masking or digesting older observations,
3. readable client-controlled summaries with recorded lineage,
4. a clear context error when reduction is insufficient.

Compaction should affect the provider request projection, not destroy durable
session history. Summaries should be inspectable and portable. Provider-side
opaque compaction must never be the only surviving representation.

Context behavior should be tested with deliberately constrained 8k and 16k local
models and tool-heavy tasks, not inferred only from large hosted context windows.

## Development path

Progress is controlled by exit criteria rather than dates.

### Stage 0: preserve and baseline

- Commit the direction documents and current brain dump.
- Create an archive branch for the current main implementation.
- Record the exact archive branch name and commit.
- Preserve benchmark results and representative current UX behavior.
- Add only narrow local observability if needed to reproduce current stalls.
- Define a small set of end-to-end acceptance journeys.

Exit when the current implementation can be restored exactly and vNext decisions
can be compared against a stable baseline.

### Stage 1: decision spikes

- Run the full-screen versus append/live TUI spike.
- Compare the leading TUI framework choices where necessary.
- Exercise a pi-ai-to-mini-coder event adapter with one local and one hosted model.
- Exercise the proposed append-only session format, including a truncated final
  write and a provider handoff.
- Trial runtime validation options against real settings, session, and extension
  data.

Exit with short evidence-based decisions. Do not implement the whole product in
spike form.

### Stage 2: walking vertical slice

Build one usable path containing:

- startup and settings,
- one local and one hosted provider path,
- normalized application events,
- a minimal system prompt,
- notepad-level input and file attachments,
- streaming assistant output,
- `bash`, `read`, and `edit`,
- unambiguous request and tool states,
- cancellation,
- append-only session persistence and resume,
- local diagnostics.

Exit when this slice can complete and diagnose real coding tasks without hidden
stalls.

At this point, decide whether continuing from the current source or replacing it
produces the smaller, clearer implementation. Reuse current authentication,
provider, argument, or tool code where it fits the new boundaries directly. Start
fresh where reuse would require parallel message models, compatibility state, or
continued coupling between provider, session, and TUI concerns.

### Stage 3: UX quality

- Complete the initial editor and attachment contract.
- Polish readable tool, reasoning, error, and cancellation presentation.
- Add settings UI with useful defaults.
- Harden scrolling, resizing, selection, terminal restoration, and long sessions.
- Keep advanced editing modes, history, and path completion deferred.

Exit when regular dogfooding feels materially better than the published version.

### Stage 4: local context and provider hardening

- Add first-class Ollama and llama.cpp onboarding and diagnostics.
- Implement and expose context reduction stages.
- Run constrained-context local-model scenarios.
- Verify hosted-provider continuation and provider handoff.

Exit when local support is genuinely a peer rather than a custom-provider example.

### Stage 5: resources and extensions

- Add root-to-leaf `AGENTS.md` and `CLAUDE.md` support.
- Add prompt templates and progressively disclosed skills.
- Add the narrow extension loader and API for tools, commands, and agents.
- Validate it with Exa and the adversary agent.
- Document extension development from the actual stable API.

Exit when users can add those demonstrated behaviors without patching core.

### Stage 6: release hardening

- Add provider fixtures and contract tests.
- Add PTY and TUI tests plus a manual terminal matrix.
- Review dependency provenance, install scripts, updates, and locked versions.
- Define session migration and export behavior.
- Compare correctness, startup, resource use, and UX against the archived version.
- Dogfood local and hosted paths before publishing.

Publish only when vNext is a better overall experience than the currently
published version.

## Acceptance journeys

The initial product decisions should be checked against a small stable set of
journeys rather than a large prose specification:

1. A first-time local user reaches an Ollama or llama.cpp model without writing a
   verbose provider model object.
2. A hosted-provider user can authenticate, choose a model, and use the same agent
   and UI behavior.
3. A coding turn always exposes whether it is preparing, waiting for a provider,
   streaming, running a named tool, cancelled, failed, or complete.
4. A multiline prompt can be edited predictably, survives an opened and cancelled
   control, accepts a large paste, and includes text or image attachments.
5. A provider or rendering stall can be diagnosed from local logs without sending
   data elsewhere.
6. A long tool-heavy task on a constrained local context shows what was omitted or
   summarized while preserving the complete durable transcript.
7. A session can continue with another provider from readable local history.
8. Exa can be installed as a tool extension without core changes.
9. An adversary agent can be configured with its own prompt, model, effort, and
   tools; its actions and transcript remain inspectable.
10. A long conversation remains responsive and copyable under the chosen
    full-screen or append/live presentation model.

## Documentation policy

Avoid another comprehensive spec that duplicates implementation details.
Maintain only:

- this product direction document,
- the original user feedback in `TODO.md`,
- focused acceptance journeys and tests,
- short decision records for expensive choices,
- extension and user documentation derived from working behavior.

Do not prescribe detailed file trees, helper APIs, rendering sketches, or internal
state before they are implemented and verified.

## Remaining decisions

The next decisions should come from the Stage 1 spikes:

- full-screen virtualized conversation or append-only conversation with a bounded
  live region,
- cel-tui, OpenTUI, or another choice justified by the spike evidence,
- reuse versus replacement of the current source,
- exact normalized session record and provider sidecar shape,
- runtime validation dependency,
- archive branch name and the commit at which vNext begins.
