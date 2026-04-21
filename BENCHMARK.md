# Running Terminal-Bench

Harbor is installed in this system with `pipx harbor`.
You will need to create a custom agent for your implementation.
keep the benchmark jobs in `benchmark-jobs/*` folder at the root of the repo.
Never run harbor evals with more than 2 concurrent evals, be aware of rate limits.

---

[Terminal-Bench](https://tbench.ai) is a benchmark for evaluating the performance of agents on terminal-based tasks. Harbor is the official harness for running Terminal-Bench 2.0.

To run Terminal-Bench you will first need to install [Harbor](/docs/getting-started). You'll know that it's installed correctly if you're able to run the oracle solutions for Terminal-Bench 2.0. Note that you will first need to install Docker and have it running on your machine:

```bash
harbor run -d terminal-bench/terminal-bench-2 -a oracle
```

You should then be able to try any of the more advanced features offered by Harbor, such as running Terminal-Bench with Claude Code on Daytona:

```bash
export DAYTONA_API_KEY="<your-daytona-api-key>"
export ANTHROPIC_API_KEY="<your-anthropic-api-key>"
harbor run \
  -d terminal-bench/terminal-bench-2 \
  -m anthropic/claude-haiku-4-5 \
  -a claude-code \
  --env daytona \
  -n 32
```

## Testing your own agent

See our docs on [agents](/docs/agents) (pasted bellow) for more information on how to test your own agent on Terminal-Bench.

## Submitting to the Terminal-Bench leaderboard

Leaderboard logs are stored in [this HuggingFace repo](https://huggingface.co/datasets/alexgshaw/terminal-bench-2-leaderboard). To submit your results, open a PR there following the instructions in the README.

## Viewing the Terminal-Bench leaderboard

You can view the leaderboard [here](https://tbench.ai/leaderboard).

---

# Agents

How to evaluate on existing agents and integrate your own. This is particularly useful for benchmarking your agent, optimizing its prompts, using it as a scaffold for RL, or using it to generate SFT datasets.

## Existing agents

Harbor comes with most popular agents pre-integrated. You can run the following command and reference the `--agent` flag to see a list of all available agents:

```bash
harbor run --help
```

Right now, Harbor includes Terminus-2, Claude Code, Copilot CLI, Codex CLI, Gemini CLI, OpenHands, Mini-SWE-Agent, and more.

## Integrating your own agent

Harbor supports integrating your own agent without having to modify the Harbor source code.

There are two types of agents:

1. **External agents** which interface with the environment through the `BaseEnvironment` interface, typically by executing bash commands via the `exec` method.
2. **Installed agents** which are agents that are installed directly into the container environment and are executed in headless mode. This is how most agents are integrated and comes with the advantage of bringing custom tools.

### External agents

To build an external agent, you need to implement the `BaseAgent` interface which involved defining the following methods:

```python title="my_external_agent.py"
from harbor.agents.base import BaseAgent

class MyExternalAgent(BaseAgent):
    @staticmethod
    def name() -> str:
        """The name of the agent."""
        pass

    def version(self) -> str | None:
        """The version of the agent."""
        pass

    async def setup(self, environment: BaseEnvironment) -> None:
        """
        Run commands to setup the agent & its tools.
        """
        pass

    async def run(
        self,
        instruction: str,
        environment: BaseEnvironment,
        context: AgentContext,
    ) -> None:
        """
        Runs the agent in the environment. Be sure to populate the context with the
        results of the agent execution. Ideally, populate the context as the agent
        executes in case of a timeout or other error.

        Args:
            instruction: The task instruction.
            environment: The environment in which to complete the task.
            context: The context to populate with the results of the agent execution.
        """
        pass
```

### Installed agents

To build an installed agent, you need to implement the `BaseInstalledAgent` interface which involves defining the following methods:

```python title="my_installed_agent.py"
from harbor.agents.installed.base import BaseInstalledAgent, with_prompt_template
from harbor.environments.base import BaseEnvironment
from harbor.models.agent.context import AgentContext

class MyInstalledAgent(BaseInstalledAgent):
    async def install(self, environment: BaseEnvironment) -> None:
        """
        Install the agent in the environment. Use exec_as_root for system
        packages and exec_as_agent for user-level installs.
        """
        await self.exec_as_root(environment, command="apt-get update && apt-get install -y curl")
        await self.exec_as_agent(environment, command="pip install my-agent")

    @with_prompt_template
    async def run(
        self, instruction: str, environment: BaseEnvironment, context: AgentContext
    ) -> None:
        """
        Run the agent in the environment. The @with_prompt_template decorator
        automatically applies prompt template rendering to the instruction.
        Use exec_as_agent to execute commands as the configured agent user.
        """
        await self.exec_as_agent(
            environment,
            command=f"my-agent run {shlex.quote(instruction)}",
        )

    def populate_context_post_run(self, context: AgentContext) -> None:
        """
        Populate the context with the results of the agent execution.
        Called after run() completes. Typically involves parsing trajectory files.
        """
        pass
```

The `exec_as_root` and `exec_as_agent` helpers handle logging, environment variable merging, `set -o pipefail`, and error handling automatically. `exec_as_agent` runs commands as the task's configured agent user (see [`agent.user` in task.toml](/docs/tasks#configuration--metadata)).

### Running a custom agent

To run a custom agent, you can use the following command:

```bash
harbor run -d "<dataset@version>" --agent-import-path path.to.agent:SomeAgent
```
