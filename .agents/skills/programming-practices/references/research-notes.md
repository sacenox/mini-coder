# Research Notes for `programming-practices`

This file captures the research basis behind the skill. Keep the
main `SKILL.md` practical; keep detailed evidence here.

## Official guidance

### OpenAI Codex — Best practices

Source: https://developers.openai.com/codex/learn/best-practices

Key takeaways used in the skill:

- Provide **goal, context, constraints, and done-when**.
- **Plan first** for complex work.
- Use `AGENTS.md` for durable project guidance.
- Improve reliability with **testing and review**.
- Start with the right task context and only add tools that
  unlock real workflows.

### GitHub Docs — Review AI-generated code

Source: https://docs.github.com/en/copilot/tutorials/review-ai-generated-code

Key takeaways used in the skill:

- Start with **functional checks**.
- Verify **context and intent**, not just syntax.
- Scrutinize **dependencies**, including hallucinated packages
  and licensing.
- Watch for AI-specific pitfalls like ignored constraints,
  hallucinated APIs, and deleted tests.
- Use CI, static analysis, and collaborative review.

### Google Cloud Blog — Five Best Practices for Using AI Coding Assistants

Source: https://cloud.google.com/blog/topics/developers-practitioners/five-best-practices-for-using-ai-coding-assistants

Key takeaways used in the skill:

- Choose the right AI tool for the task.
- Document the repo early so later generation is grounded.
- **Make a plan** before executing complex work.
- Prompt with relevant detail.
- Preserve cross-session context in durable files.

## Research on recurring failure modes

### LLM Hallucinations in Practical Code Generation (PACMSE / 2025)

Source: https://dl.acm.org/doi/10.1145/3728894
Also available as preprint: https://arxiv.org/pdf/2409.20550

Why it matters:

- Focuses on **repository-level** generation rather than isolated
  toy functions.
- Identifies three major hallucination categories:
  - Task Requirement Conflicts
  - Factual Knowledge Conflicts
  - Project Context Conflicts
- Highlights four contributing factors:
  - training data quality
  - intention understanding capacity
  - knowledge acquisition capacity
  - repository-level context awareness

How it shaped the skill:

- Read the surrounding code first.
- Match repo-local conventions.
- Verify APIs and project assumptions.
- Treat repo context as part of correctness.

### Beyond Functional Correctness: Exploring Hallucinations in LLM-Generated Code (2024)

Source: https://arxiv.org/html/2404.00971v3

Why it matters:

- Builds a broader taxonomy of code hallucinations.
- Shows that failures are not just about failing tests; they also
  affect maintainability, readability, efficiency, and alignment
  with user intent.

How it shaped the skill:

- Do not equate plausible output with correct output.
- Check intent alignment, not just compilability.

### We Have a Package for You! / Package Hallucinations (USENIX Security 2025)

USENIX summary: https://www.usenix.org/publications/loginonline/we-have-package-you-comprehensive-analysis-package-hallucinations-code
Paper repo summary: https://github.com/Spracks/PackageHallucination
ArXiv preprint: https://arxiv.org/pdf/2406.10279

Key findings referenced in the skill:

- 576,000 code samples analyzed across 16 LLMs.
- Average hallucinated package rate was at least:
  - **5.2%** for commercial models
  - **21.7%** for open-source models
- **205,474** unique hallucinated package names were found.

How it shaped the skill:

- Never introduce a dependency without verification.
- Treat unfamiliar package suggestions as a supply-chain risk.

### More Code, Less Reuse: Investigating Code Quality and Reviewer Sentiment towards AI-generated Pull Requests (2026 preprint)

Source: https://arxiv.org/abs/2601.21276

Why it matters:

- Reports that agent-authored PRs frequently miss reuse
  opportunities and contain more redundancy than human PRs.
- Notes a disconnect between objective quality issues and often
  neutral or positive reviewer sentiment.

How it shaped the skill:

- Search for existing helpers before adding new logic.
- Do not trust surface plausibility alone.
- Favor reuse over near-duplicate implementations.

### Where Do AI Coding Agents Fail? An Empirical Study of Failed Agentic Pull Requests in GitHub (2026 preprint)

Source: https://arxiv.org/abs/2601.15195v1

Key findings:

- Large-scale study of **33k** agent-authored PRs.
- Not-merged PRs tended to be larger, touch more files, and fail
  CI/CD more often.
- Rejection reasons included duplicate PRs, unwanted feature
  implementations, and agent misalignment.

How it shaped the skill:

- Keep changes small and scoped.
- Avoid broad edits for narrow requests.
- Stay aligned with the user's stated task.

### Analyzing Message-Code Inconsistency in AI Coding Agent-Authored Pull Requests (2026 preprint)

Source: https://arxiv.org/abs/2601.04886

Key findings:

- Analyzed **23,247** agentic PRs.
- **1.7%** showed high message-code inconsistency.
- The most common inconsistency type was descriptions claiming
  unimplemented changes (**45.4%**).
- High-inconsistency PRs had lower acceptance rates and took
  longer to merge.

How it shaped the skill:

- Summaries must match the diff.
- Do not overstate what changed or what was verified.

### AI-Generated Code Is Not Reproducible (Yet): An Empirical Study of Dependency Gaps in LLM-Based Coding Agents (2026 preprint)

Source: https://arxiv.org/abs/2512.22387

Key findings:

- Evaluated 300 generated projects across Python, JavaScript,
  and Java.
- Only **68.3%** executed successfully out of the box in a clean
  environment.
- Observed a **13.5x** average expansion from declared to actual
  runtime dependencies.

How it shaped the skill:

- Hidden dependencies are common.
- Working in one environment is not proof that setup is correct.
- Make runtime assumptions explicit.

### "TODO: Fix the Mess Gemini Created": Towards Understanding GenAI-Induced Self-Admitted Technical Debt (2026 preprint)

Source: https://arxiv.org/abs/2601.07786

Why it matters:

- Found recurring self-admitted debt patterns in AI-generated
  code: postponed testing, incomplete adaptation, and limited
  understanding of what the code actually does.

How it shaped the skill:

- Do not ship code you cannot explain.
- Do not leave uncertainty disguised as completion.

## Notes on evidence quality

- The official docs above are vendor guidance and reflect current
  operational best practices.
- The package hallucination work and the PACMSE repository-level
  hallucination paper are strong anchors because they study
  code-generation failure modes directly.
- Several 2026 papers cited here are preprints. They are still
  useful because they converge on the same practical patterns:
  larger diffs, poorer reuse, hidden dependencies, overclaiming,
  and context misalignment.

## Practical synthesis

Across the sources, the same engineering advice keeps showing up:

1. Give the agent the right context.
2. Plan before coding on complex tasks.
3. Follow repo-local patterns.
4. Reuse existing code before inventing new abstractions.
5. Verify dependencies, APIs, and environment assumptions.
6. Keep diffs small and scoped.
7. Run checks.
8. Report exactly what changed and what was verified.
