# mini-coder TODO

Before anything else, read mini-coder-spec.md first.

We want to start working on the migration from the current mvp code to the state described in the spec. This is a major refactor and we should treat existing code as reference only, and focus on implementing the spec accurately by re-writting it correctly from scratch.

We need to take this systematically:

1. Remove the existing tests, all of them.
2. Remove all extra features that are not in the spec from the mvp code in src.
3. Create the packages file tree and packages bootstrap. Ensure the monorepo is well configured with scripts and pre-commit hook like we have today. Code freeze the src directory.
4. Start re-writting each package using the mvp src folder as reference, but focus on the spec as the source of truth. Do not mix the existing mvp features with the intended design in the spec. Use test driven development. First make the test based on the intended behaviour from the spec, then implement the new code. Do not import from the mvp code in src from the new packages, this is an intended clean re-write.
5. Loop step 4 until completion.

During this task, act as the orchestrator of subagents, and coordinate them to complete the whole refactor. Avoid making edits and changes yourself to keep your context usage at a minimum since it's a long task.

** TRACK YOUR PROGRESS BELLOW; DO NOT EDIT ABOVE THIS LINE **
