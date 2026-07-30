# Human's TODO list.

> This file is managed by the user, only edit if asked to.

## TODO

This prototype version has lived it's course, and I've extracted the insights I wanted from it.
In addition to the insights from using this prototype, this feedback also stems from using other coding agents extensively over the past few months. These include Pi Coding Agent, Opencode, Claude Code, Cursor and Codex CLI.

I'm just going to dump all my thoughts into this file, and we can format and structure it with agents.

One big takeaway was Pi's "extensible software" foundation, this is amazing and there is a lot of value in putting extensibility first (I even authored and compiled my extensions into a repo ../pi-extensions)

Using pi-ai is a great decision, and allows us to mostly ignore provider differences. But as providers continue to iterate on the format of their apis and difer more and more, this might become a limitation.
One thing that keeps coming up in my mind is what would an extensible provider api/library would look like. Maybe it could provide the separate building blocks and allow library consumers to assemble them for any provider? I'm not sure about this, but as things evolve, this might be a big deal for mini-coder. (context, a blog post about provider divergence from the pi team: https://earendil.com/posts/session-portability/). Another thing I would have done different would be to flatten the content, or string arrays from the LLM responses for presentation, instead of trying to rely on the pi-ai types.

Pi won it's place as my main choice, mostly because I was able to bring my prefered features with extensions without much effort. It also feels the best to me, it's minimal system prompt allows for all sorts of tasks, from educational requests to generic Chatbot uses with custom prompts. I've noticed that the heavier the system prompt, the less versatile the coding agent feels to me.

Opencode has the best UX and UI, feels modern and nice to use. It's miles ahead of any other terminal coding agent user experience. Pi, Claude Code and Codex all fall short when compared to Opencode's UI. The downside is that the agent implementation of Opencode is very opiniated and while there are plenty of nobs to tweak via configs, it still feels more constrained than using Pi (which is minminal even in it's agent implementation). Claude Code and Codex feel nice with their respective models, but usage is weird and there is little transparency over the actions of the llms. (my config in in ~/.config/opencode)

Claude Code, Codex and Cursor are all things I use in a working context (not on this machine). And my feedback about them is mostly negative. All of them hide/mask agent actions, have every feature you can think of, even the ones that might not be the best choices (reasoning summaries instead of traces, generic "subagent is doing things" outputs, server side compaction, and other are examples of patterns that hide agent behaviour from the user).

Current mini-coder is not really an enjoyable experience, the app stalls with no UI messaging, there is no logs or telemetry to debug when something doesn't work, the whole UX doesn't feel good, and the input editor is very limitted.

Local AI is emerging, I myself am waiting to receive a NVIDIA Spark to run local models at home. Most coding agents support local llms, mostly, but none feels first class and all require verbose configs. It would be a good niche for mini-coder to have first class support for ollama/llama.cpp at least. Maybe the idea of a modular provider api can be applied here too? As part of this I explored what a local AI first agent would look like in ../feather . And the biggest feedback out of it, is that local ai tens to have pretty small context windows, so compaction is tricky and vital for any sort of agentic flow.

The features I think fit my idea for mini-coder, and should be part of the core:

- Elegant and polished UI, with transparency and readability first. Not noise or spam. First class editting in the prompt input. UI to customize settings, with reasonable defaults.
- base agent abilitites on par with Pi, as in: a simple set of tools, compaction to protect context window busts, minimal system prompt, skills support and prompt templates. Context files support AGENTS.md/CLAUDE.md
- Opencode style custom agents/subagents, where the model/effort and prompt can be customized and then invoked by the main llm (for example the adversary pi extension I use, or the same for the opencode config).
- Extensibility, with agents this is critical so users can add/remove to their wishes.
- Agents docs with the coding agent harness: this is awesome, being able to say "help me add X to pi/opencode" is quite the powerful UX.

Some words about cel-tui, we made it for mini-coder, and it's a full agent authored spec driven implementation (probably the reason I dislike spec driven projects). It's a good library, and has been dependable and performant, but putting favoritism aside and considering other TUI implementations might be healthy, even if it's to take insights to improve cel-tui. Keep in mind that it's quite cumbersome to iterate over cel-tui, as all changes require a billion edits in specs, docs and code, and if they fall out of sync, every following agent gets confused and mistakes compound.

I'm not sure how to further spec this out, I don't really want to write a massive spec file that becomes a maintenance chore and might contradict with the code or tests. Between the current main branch prototype and the two archived implementations, there is a lot to infer from, both correct and wrong, so I'm weary of just pointing agents to those. Same with the feather code, it has it's downsides.

Typescript lessons: I didn't like typebox, and I'm overall pretty tired of typescript types. I'm open to suggestions here, but I'm starting to think that typescript is 90% validating types and avoiding `any`... So a mature type handling dependency might go a long way. Other than that, dependencies need to be considered very carefully, supply chain attacks are more common now, and it's likely going to keep increasing.

We don't have pressure, neither time or user pressure at all. The current version is stable, and to be honest I don't think anyone uses mini-coder as their main agent. Even me, I mostly use it as a consistent base for benchmarks, since other harnesses keep getting updates mid benchmarks! This to say, if the correct implemtation requires a lot of work and might take a long time, that is ok. I rather go slow and correct, than to make more design mistakes or introduce bad code/technical dept.

next version will kick off whatever direction we ended deciding from this wall of text I call feedback :)
