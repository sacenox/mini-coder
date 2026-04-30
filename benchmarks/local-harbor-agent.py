from __future__ import annotations

import json
import shlex
import tarfile
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Any

from harbor.agents.installed.base import BaseInstalledAgent
from harbor.environments.base import BaseEnvironment
from harbor.models.agent.context import AgentContext
from harbor.models.trial.paths import EnvironmentPaths


class LocalMiniCoderAgent(BaseInstalledAgent):
    """Minimal Harbor installed-agent wrapper for the local mini-coder checkout."""

    CONTAINER_ROOT = "/tmp/mini-coder-next"
    STDOUT_LOG = "mini-coder.ndjson"
    STDERR_LOG = "mini-coder.stderr.txt"

    @staticmethod
    def name() -> str:
        return "mini-coder-local"

    def __init__(self, *args: Any, version: str = "local", **kwargs: Any) -> None:
        super().__init__(*args, version=version, **kwargs)
        self.repo_root = Path(__file__).resolve().parents[1]

    async def install(self, environment: BaseEnvironment) -> None:
        await self.exec_as_root(
            environment,
            command=(
                "apt-get update && "
                "apt-get install -y curl unzip ca-certificates bash"
            ),
            env={"DEBIAN_FRONTEND": "noninteractive"},
        )

        await self.exec_as_agent(
            environment,
            command=(
                'if ! command -v bun >/dev/null 2>&1; then '
                "curl -fsSL https://bun.sh/install | bash; "
                "fi"
            ),
        )

        with TemporaryDirectory(prefix="mini-coder-harbor-") as tmp:
            tarball = Path(tmp) / "mini-coder-next.tgz"
            self._make_source_tarball(tarball)
            await environment.upload_file(tarball, "/tmp/mini-coder-next.tgz")

        await self.exec_as_agent(
            environment,
            command=(
                f"rm -rf {shlex.quote(self.CONTAINER_ROOT)} && "
                f"mkdir -p {shlex.quote(self.CONTAINER_ROOT)} && "
                f"tar -xzf /tmp/mini-coder-next.tgz -C {shlex.quote(self.CONTAINER_ROOT)} && "
                'export PATH="$HOME/.bun/bin:$PATH"; '
                f"cd {shlex.quote(self.CONTAINER_ROOT)} && "
                "bun install --frozen-lockfile"
            ),
        )

    async def run(
        self,
        instruction: str,
        environment: BaseEnvironment,
        context: AgentContext,
    ) -> None:
        del context

        home = await self._container_home(environment)

        stdout_path = (EnvironmentPaths.agent_dir / self.STDOUT_LOG).as_posix()
        stderr_path = (EnvironmentPaths.agent_dir / self.STDERR_LOG).as_posix()

        # Build CLI flags. Harbor's -m flag sets self.model_name as
        # "provider/model" (e.g. "openai-codex/gpt-5.5").
        cmd_parts = [
            f"bun {shlex.quote(self.CONTAINER_ROOT + '/bin/mc.ts')}",
            f"--prompt {shlex.quote(instruction)}",
            "--effort xhigh",
        ]

        if self._parsed_model_provider and self._parsed_model_name:
            cmd_parts.append(
                f"--provider {shlex.quote(self._parsed_model_provider)}"
            )
            cmd_parts.append(f"--model {shlex.quote(self._parsed_model_name)}")

        cmd = (
            f"export HOME={shlex.quote(home)}; "
            f'export PATH="{home}/.bun/bin:$PATH"; '
            f"{' '.join(cmd_parts)} "
            f"</dev/null >{shlex.quote(stdout_path)} 2>{shlex.quote(stderr_path)}"
        )

        await self.exec_as_agent(environment, command=cmd)

    def populate_context_post_run(self, context: AgentContext) -> None:
        stdout_path = self.logs_dir / self.STDOUT_LOG
        stderr_path = self.logs_dir / self.STDERR_LOG

        metadata = {
            "mini_coder_stdout": str(stdout_path),
            "mini_coder_stderr": str(stderr_path),
        }

        usage = self._extract_usage(stdout_path)
        if usage:
            context.n_input_tokens = self._as_int(usage.get("input"))
            context.n_output_tokens = self._as_int(usage.get("output"))

            cost = usage.get("cost")
            if isinstance(cost, dict):
                context.cost_usd = self._as_float(cost.get("total"))

            metadata["usage"] = usage

        context.metadata = {**(context.metadata or {}), **metadata}

    def _make_source_tarball(self, tarball: Path) -> None:
        required = ["package.json", "bun.lock", "bin", "src"]

        for name in required:
            path = self.repo_root / name
            if not path.exists():
                raise FileNotFoundError(f"Missing required mini-coder file: {path}")

        with tarfile.open(tarball, "w:gz") as tf:
            for name in required:
                tf.add(self.repo_root / name, arcname=name)

            tsconfig = self.repo_root / "tsconfig.json"
            if tsconfig.exists():
                tf.add(tsconfig, arcname="tsconfig.json")

    async def _container_home(self, environment: BaseEnvironment) -> str:
        result = await self.exec_as_agent(environment, command='printf %s "$HOME"')
        home = (result.stdout or "").strip()
        if not home:
            raise RuntimeError("Could not determine container HOME")
        return home

    @staticmethod
    def _extract_usage(path: Path) -> dict[str, Any] | None:
        if not path.exists():
            return None

        # mini-coder --json currently emits newline-delimited JSON events.
        for line in reversed(path.read_text(encoding="utf-8", errors="replace").splitlines()):
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                continue

            if not isinstance(event, dict):
                continue

            message = event.get("message")
            if isinstance(message, dict) and isinstance(message.get("usage"), dict):
                return message["usage"]

            if isinstance(event.get("usage"), dict):
                return event["usage"]

        return None

    @staticmethod
    def _as_int(value: Any) -> int | None:
        return value if isinstance(value, int) and not isinstance(value, bool) else None

    @staticmethod
    def _as_float(value: Any) -> float | None:
        return float(value) if isinstance(value, int | float) and not isinstance(value, bool) else None