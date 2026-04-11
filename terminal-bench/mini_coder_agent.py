from __future__ import annotations

import shlex
from pathlib import Path

from harbor.agents.installed.base import BaseInstalledAgent, with_prompt_template
from harbor.environments.base import BaseEnvironment
from harbor.models.agent.context import AgentContext
from harbor.models.trial.paths import EnvironmentPaths


class MiniCoderAgent(BaseInstalledAgent):
    """Harbor installed-agent wrapper for the published mini-coder CLI."""

    def __init__(self, *args, version: str = "latest", **kwargs):
        super().__init__(*args, version=version, **kwargs)
        self._host_config_dir = Path.home() / ".config" / "mini-coder"
        self._host_settings_path = self._host_config_dir / "settings.json"
        self._host_auth_path = self._host_config_dir / "auth.json"

    @staticmethod
    def name() -> str:
        return "mini-coder"

    async def _install_system_dependencies(self, environment: BaseEnvironment) -> None:
        await self.exec_as_root(
            environment,
            command=(
                "if command -v apt-get >/dev/null 2>&1; then "
                "apt-get update && apt-get install -y curl unzip ca-certificates bash git python3 ripgrep; "
                "elif command -v apk >/dev/null 2>&1; then "
                "apk add --no-cache curl unzip ca-certificates bash git python3 ripgrep; "
                "else "
                'echo "Unsupported package manager for mini-coder install" >&2; exit 1; '
                "fi"
            ),
            env={"DEBIAN_FRONTEND": "noninteractive"},
        )

    async def _install_bun(self, environment: BaseEnvironment) -> None:
        await self.exec_as_agent(
            environment,
            command=(
                "set -euo pipefail; "
                "curl -fsSL https://bun.sh/install | bash; "
                'export PATH="$HOME/.bun/bin:$PATH"; '
                "test -x ~/.bun/bin/bun"
            ),
        )

    async def _install_global_package(
        self,
        environment: BaseEnvironment,
        package_spec: str,
        *,
        ignore_scripts: bool,
    ) -> None:
        ignore_scripts_flag = "--ignore-scripts " if ignore_scripts else ""
        await self.exec_as_agent(
            environment,
            command=(
                'export PATH="$HOME/.bun/bin:$PATH"; '
                f"bun add -g {ignore_scripts_flag}{shlex.quote(package_spec)}; "
                "test -x ~/.bun/bin/bun; "
                "test -x ~/.bun/bin/mc"
            ),
        )

    async def install(self, environment: BaseEnvironment) -> None:
        await self._install_system_dependencies(environment)
        await self._install_bun(environment)
        await self._install_global_package(
            environment,
            f"mini-coder@{self._version}",
            ignore_scripts=False,
        )

    def populate_context_post_run(self, context: AgentContext) -> None:
        return None

    def _require_host_config(self) -> None:
        missing: list[str] = []
        if not self._host_settings_path.is_file():
            missing.append(str(self._host_settings_path))
        if not self._host_auth_path.is_file():
            missing.append(str(self._host_auth_path))
        if missing:
            raise FileNotFoundError(
                "Missing local mini-coder config files required for the Harbor run: "
                + ", ".join(missing)
            )

    async def _container_config_dir(self, environment: BaseEnvironment) -> str:
        result = await self.exec_as_agent(environment, command='printf %s "$HOME"')
        home_dir = (result.stdout or "").strip()
        if not home_dir:
            raise RuntimeError("Failed to determine the agent home directory")
        config_dir = f"{home_dir}/.config/mini-coder"
        await self.exec_as_agent(
            environment,
            command=f"mkdir -p {shlex.quote(config_dir)}",
        )
        return config_dir

    async def _upload_host_config(
        self, environment: BaseEnvironment, config_dir: str
    ) -> None:
        settings_target = f"{config_dir}/settings.json"
        auth_target = f"{config_dir}/auth.json"
        await environment.upload_file(self._host_settings_path, settings_target)
        await environment.upload_file(self._host_auth_path, auth_target)
        await self.exec_as_agent(
            environment,
            command=(
                f"chmod 600 {shlex.quote(settings_target)} {shlex.quote(auth_target)}"
            ),
        )

    @with_prompt_template
    async def run(
        self,
        instruction: str,
        environment: BaseEnvironment,
        context: AgentContext,
    ) -> None:
        del context
        self._require_host_config()
        config_dir = await self._container_config_dir(environment)
        await self._upload_host_config(environment, config_dir)

        escaped_instruction = shlex.quote(instruction)
        ndjson_path = (EnvironmentPaths.agent_dir / "mini-coder.ndjson").as_posix()
        stderr_path = (EnvironmentPaths.agent_dir / "mini-coder.stderr.txt").as_posix()

        await self.exec_as_agent(
            environment,
            command=(
                'export PATH="$HOME/.bun/bin:$PATH"; '
                f"mc -p {escaped_instruction} </dev/null "
                f">{shlex.quote(ndjson_path)} "
                f"2>{shlex.quote(stderr_path)}"
            ),
        )
