from __future__ import annotations

import shlex
import subprocess
from pathlib import Path
from tempfile import TemporaryDirectory

from harbor.agents.installed.base import BaseInstalledAgent, with_prompt_template
from harbor.environments.base import BaseEnvironment
from harbor.models.agent.context import AgentContext
from harbor.models.trial.paths import EnvironmentPaths


class LocalMiniCoderAgent(BaseInstalledAgent):
    """Harbor installed-agent wrapper for this local mini-coder checkout."""

    def __init__(self, *args, version: str = "local", **kwargs):
        super().__init__(*args, version=version, **kwargs)
        self._host_repo_root = Path(__file__).resolve().parents[1]
        self._host_auth_path = Path.home() / ".config" / "mini-coder" / "auth.json"

    @staticmethod
    def name() -> str:
        return "mini-coder-local"

    async def install(self, environment: BaseEnvironment) -> None:
        self._require_host_checkout()
        await self._install_system_dependencies(environment)
        await self._install_bun(environment)

        with TemporaryDirectory(prefix="mini-coder-harbor-") as temp_dir:
            tarball_path = self._package_local_checkout(Path(temp_dir))
            container_tarball_path = f"/tmp/{tarball_path.name}"
            await environment.upload_file(tarball_path, container_tarball_path)
            await self._install_global_package(environment, container_tarball_path)

    def populate_context_post_run(self, context: AgentContext) -> None:
        del context

    def _require_host_checkout(self) -> None:
        missing = [
            path
            for path in (
                self._host_repo_root / "package.json",
                self._host_repo_root / "bin" / "mc.ts",
                self._host_repo_root / "src",
            )
            if not path.exists()
        ]
        if missing:
            raise FileNotFoundError(
                "Missing local mini-coder checkout files required for Harbor: "
                + ", ".join(str(path) for path in missing)
            )

    def _require_host_auth(self) -> None:
        if not self._host_auth_path.is_file():
            raise FileNotFoundError(
                f"Missing mini-coder auth file required for Harbor: {self._host_auth_path}"
            )

    def _package_local_checkout(self, target_dir: Path) -> Path:
        target_dir.mkdir(parents=True, exist_ok=True)
        tarball_path = target_dir / "mini-coder-local.tgz"

        try:
            result = subprocess.run(
                [
                    "bun",
                    "pm",
                    "pack",
                    "--ignore-scripts",
                    "--filename",
                    str(tarball_path),
                ],
                cwd=self._host_repo_root,
                capture_output=True,
                text=True,
                check=False,
            )
        except FileNotFoundError as exc:
            raise RuntimeError("bun is required on the host to package mini-coder") from exc

        if result.returncode != 0:
            details = result.stderr.strip() or result.stdout.strip() or "unknown error"
            raise RuntimeError(f"Failed to package mini-coder: {details}")
        if not tarball_path.is_file():
            raise RuntimeError(f"Expected mini-coder package at {tarball_path}")

        return tarball_path

    async def _install_system_dependencies(self, environment: BaseEnvironment) -> None:
        await self.exec_as_root(
            environment,
            command=(
                "if command -v apt-get >/dev/null 2>&1; then "
                "apt-get update && apt-get install -y curl unzip ca-certificates bash; "
                "elif command -v apk >/dev/null 2>&1; then "
                "apk add --no-cache curl unzip ca-certificates bash; "
                "elif command -v yum >/dev/null 2>&1; then "
                "yum install -y curl unzip ca-certificates bash; "
                "else echo 'Unsupported package manager for mini-coder install' >&2; exit 1; fi"
            ),
            env={"DEBIAN_FRONTEND": "noninteractive"},
        )

    async def _install_bun(self, environment: BaseEnvironment) -> None:
        await self.exec_as_agent(
            environment,
            command=(
                "if ! command -v bun >/dev/null 2>&1; then "
                "curl -fsSL https://bun.sh/install | bash; fi; "
                "export PATH=\"$HOME/.bun/bin:$PATH\"; "
                "test -x \"$(command -v bun)\""
            ),
        )

    async def _install_global_package(
        self, environment: BaseEnvironment, package_spec: str
    ) -> None:
        await self.exec_as_agent(
            environment,
            command=(
                "export PATH=\"$HOME/.bun/bin:$PATH\"; "
                f"bun add -g --ignore-scripts {shlex.quote(package_spec)}; "
                "test -x ~/.bun/bin/mc || command -v mc >/dev/null"
            ),
        )

    async def _container_config_dir(self, environment: BaseEnvironment) -> str:
        result = await self.exec_as_agent(environment, command='printf %s "$HOME"')
        home_dir = (result.stdout or "").strip()
        if not home_dir:
            raise RuntimeError("Failed to determine the agent home directory")

        config_dir = f"{home_dir}/.config/mini-coder"
        await self.exec_as_agent(environment, command=f"mkdir -p {shlex.quote(config_dir)}")
        return config_dir

    async def _upload_host_auth(
        self, environment: BaseEnvironment, config_dir: str
    ) -> None:
        tmp_auth_path = "/tmp/mini-coder-auth.json"
        auth_target = f"{config_dir}/auth.json"
        await environment.upload_file(self._host_auth_path, tmp_auth_path)
        await self.exec_as_root(environment, command=f"chmod 644 {tmp_auth_path}")
        await self.exec_as_agent(
            environment,
            command=(
                f"cp {shlex.quote(tmp_auth_path)} {shlex.quote(auth_target)} && "
                f"chmod 600 {shlex.quote(auth_target)}"
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
        self._require_host_auth()
        config_dir = await self._container_config_dir(environment)
        await self._upload_host_auth(environment, config_dir)

        stdout_path = (EnvironmentPaths.agent_dir / "mini-coder.json").as_posix()
        stderr_path = (EnvironmentPaths.agent_dir / "mini-coder.stderr.txt").as_posix()
        await self.exec_as_agent(
            environment,
            command=(
                "export PATH=\"$HOME/.bun/bin:$PATH\"; "
                f"mc --json -p {shlex.quote(instruction)} </dev/null "
                f">{shlex.quote(stdout_path)} "
                f"2>{shlex.quote(stderr_path)}"
            ),
        )
