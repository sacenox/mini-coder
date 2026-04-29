<p align="center">
  <img src="assets/icon-2-dark-terminal.svg" alt="mini-coder logo" width="112" />
</p>

<h1 align="center">mini-coder</h1>

<p align="center"><strong>Lightning-fast coding agent for your terminal.</strong></p>

<p align="center">
  <a href="https://www.npmjs.com/package/mini-coder">npm</a>
  ·
  <a href="https://sacenox.github.io/mini-coder/">docs</a>
  ·
  <a href="spec.md">spec</a>
</p>

<p align="center">
  <picture>
    <img src="assets/preview.gif" alt="mini-coder terminal session preview" width="960" style="border-radius: 10px; box-shadow: 0 10px 30px rgba(0,0,0,0.35);" />
  </picture>
</p>

mini-coder (`mc`) is a terminal coding agent, hand crafted for transparency and good engineering performance.

## Install

```bash
$ bun add -g mini-coder
$ mc
```

## Why mini-coder?

- **Lean on proven dependencies** — [pi-ai](https://github.com/badlogic/pi-mono/tree/main/packages/ai) for providers, streaming, tool calling, usage tracking, and OAuth. [cel-tui](https://github.com/sacenox/cel-tui) for the terminal UI. The core stays focused on agent work.
- **Flat, simple codebase** — no workspaces, no internal abstraction layers. Files grouped by concern in a single `src/` directory.
- **Agent-first** — every decision serves the goal of reading code, making changes, and verifying them via the shell.
- **Performance** — startup and turn latency matter more than features.
- **Streaming end-to-end** — assistant text, reasoning, tool calls, and tool output show up as they happen.
- **Isolation friendly**— works inside [nono](https://nono.sh/). Suggested profile in `nono-mini-coder.json`

## Settings

> Warning, settings have changed, update your old settings file!

Global defaults live in `~/.config/mini-coder/settings.json`.

Create or edit it directly to set the default provider, model, reasoning effort, and any custom models. `customProviders` entries use the pi-ai `Model` shape; the top-level `provider` and `model` select the active entry.

```json
{
  "provider": "ollama",
  "model": "llama3.1:8b",
  "effort": "medium",
  "customProviders": [
    {
      "id": "llama3.1:8b",
      "name": "Llama 3.1 8B (Ollama)",
      "api": "openai-completions",
      "provider": "ollama",
      "baseUrl": "http://localhost:11434/v1",
      "reasoning": false,
      "input": ["text"],
      "cost": {
        "input": 0,
        "output": 0,
        "cacheRead": 0,
        "cacheWrite": 0
      },
      "contextWindow": 128000,
      "maxTokens": 32000
    }
  ]
}
```

Use `api: "openai-completions"` for OpenAI-compatible servers such as Ollama, vLLM, LiteLLM, and local proxies. For local OpenAI-compatible custom providers, mini-coder supplies the dummy API key required by pi-ai when no real key is needed.

## Also makes LLMs smarter

LLMs famously tell you to walk 50 meters to the car wash — forgetting the car needs to be there too. Not on our watch.

<table align="center">
  <tr>
    <td><img src="assets/mc-claude-smart.png" alt="Claude correctly answering the car wash question" width="400" /></td>
    <td><img src="assets/mc-gpt-smart.png" alt="GPT correctly answering the car wash question" width="400" /></td>
  </tr>
</table>

## License

MIT
