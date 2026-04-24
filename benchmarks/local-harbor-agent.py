from __future__ import annotations

import json
import shlex
import shutil
import subprocess
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Any

from harbor.agents.installed.base import BaseInstalledAgent, with_prompt_template
from harbor.environments.base import BaseEnvironment
from harbor.models.agent.context import AgentContext
from harbor.models.trial.paths import EnvironmentPaths


class LocalMiniCoderAgent(BaseInstalledAgent):
    """Harbor installed-agent wrapper for this local mini-coder checkout."""

    _JSON_LOG_FILENAME = "mini-coder.json"
    _STDERR_LOG_FILENAME = "mini-coder.stderr.txt"
    _PACKAGE_PATHS = ("bin/mc.ts", "src")
    _PACKAGE_MANIFEST_KEYS = ("name", "version", "type", "bin", "dependencies")

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
        output_path = self.logs_dir / self._JSON_LOG_FILENAME
        stderr_path = self.logs_dir / self._STDERR_LOG_FILENAME
        metadata: dict[str, Any] = {
            "json_log_path": str(output_path),
            "stderr_log_path": str(stderr_path),
        }

        if stderr_path.is_file():
            stderr_text = stderr_path.read_text(
                encoding="utf-8", errors="replace"
            ).strip()
            if stderr_text:
                metadata["stderr_excerpt"] = self._truncate_metadata_text(stderr_text)

        try:
            with output_path.open(encoding="utf-8") as handle:
                result = json.load(handle)
        except FileNotFoundError:
            metadata["parse_error"] = f"Missing mini-coder JSON log: {output_path}"
            self._merge_context_metadata(context, metadata)
            return
        except json.JSONDecodeError as exc:
            metadata["parse_error"] = f"Invalid mini-coder JSON log: {exc}"
            metadata["stdout_excerpt"] = self._read_text_excerpt(output_path)
            self._merge_context_metadata(context, metadata)
            return
        except OSError as exc:
            metadata["parse_error"] = f"Failed to read mini-coder JSON log: {exc}"
            self._merge_context_metadata(context, metadata)
            return

        if not isinstance(result, dict):
            metadata["parse_error"] = "mini-coder JSON log was not an object"
            self._merge_context_metadata(context, metadata)
            return

        usage = result.get("usage")
        usage_data = usage if isinstance(usage, dict) else {}

        context.n_input_tokens = self._optional_int(usage_data.get("input"))
        context.n_output_tokens = self._optional_int(usage_data.get("output"))

        cache_read = self._optional_int(usage_data.get("cacheRead"))
        cache_write = self._optional_int(usage_data.get("cacheWrite"))
        if cache_read is not None or cache_write is not None:
            context.n_cache_tokens = (cache_read or 0) + (cache_write or 0)

        cost = usage_data.get("cost")
        if isinstance(cost, dict):
            context.cost_usd = self._optional_float(cost.get("total"))

        for source_key, metadata_key in (
            ("api", "api"),
            ("provider", "provider"),
            ("model", "model"),
            ("responseId", "response_id"),
            ("stopReason", "stop_reason"),
            ("errorMessage", "error_message"),
        ):
            value = result.get(source_key)
            if isinstance(value, str) and value:
                metadata[metadata_key] = value

        if usage:
            metadata["usage"] = usage

        self._merge_context_metadata(context, metadata)

    @staticmethod
    def _optional_int(value: Any) -> int | None:
        if isinstance(value, bool):
            return None
        if isinstance(value, int):
            return value
        if isinstance(value, float) and value.is_integer():
            return int(value)
        return None

    @staticmethod
    def _optional_float(value: Any) -> float | None:
        if isinstance(value, bool):
            return None
        if isinstance(value, (int, float)):
            return float(value)
        return None

    @staticmethod
    def _truncate_metadata_text(text: str, max_chars: int = 4000) -> str:
        if len(text) <= max_chars:
            return text
        return text[:max_chars] + " ... [truncated]"

    def _read_text_excerpt(self, path: Path) -> str:
        try:
            return self._truncate_metadata_text(
                path.read_text(encoding="utf-8", errors="replace").strip()
            )
        except OSError as exc:
            return f"<failed to read {path}: {exc}>"

    @staticmethod
    def _merge_context_metadata(
        context: AgentContext, metadata: dict[str, Any]
    ) -> None:
        existing = context.metadata or {}
        context.metadata = {**existing, **metadata}

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
        package_root = target_dir / "mini-coder-package"
        tarball_path = target_dir / "mini-coder-local.tgz"
        self._stage_minimal_package(package_root)

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
                cwd=package_root,
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

    def _stage_minimal_package(self, package_root: Path) -> None:
        if package_root.exists():
            shutil.rmtree(package_root)
        package_root.mkdir(parents=True)

        package_manifest = self._minimal_package_manifest()
        (package_root / "package.json").write_text(
            json.dumps(package_manifest, indent=2) + "\n", encoding="utf-8"
        )

        for relative_path in self._PACKAGE_PATHS:
            source_path = self._host_repo_root / relative_path
            target_path = package_root / relative_path
            if source_path.is_dir():
                shutil.copytree(source_path, target_path)
            else:
                target_path.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(source_path, target_path)

    def _minimal_package_manifest(self) -> dict[str, Any]:
        manifest_path = self._host_repo_root / "package.json"
        source_manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        if not isinstance(source_manifest, dict):
            raise RuntimeError(f"Invalid package manifest at {manifest_path}")

        package_manifest = {
            key: source_manifest[key]
            for key in self._PACKAGE_MANIFEST_KEYS
            if key in source_manifest
        }
        missing = [
            key
            for key in ("name", "version", "type", "bin")
            if key not in package_manifest
        ]
        if missing:
            raise RuntimeError(
                f"Missing required package manifest keys: {', '.join(missing)}"
            )

        return package_manifest

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
                f"bun add -g --ignore-scripts {shlex.quote(package_spec)} && "
                "test -x ~/.bun/bin/mc"
            ),
        )

    async def _container_config_dir(self, environment: BaseEnvironment) -> str:
        result = await self.exec_as_agent(environment, command='printf %s "$HOME"')
        home_dir = (result.stdout or "").strip()
        if not home_dir:
            raise RuntimeError("Failed to determine the agent home directory")

        config_dir = f"{home_dir}/.config/mini-coder"
        await self.exec_as_agent(
            environment, command=f"mkdir -p {shlex.quote(config_dir)}"
        )
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

        stdout_path = (
            EnvironmentPaths.agent_dir / self._JSON_LOG_FILENAME
        ).as_posix()
        stderr_path = (
            EnvironmentPaths.agent_dir / self._STDERR_LOG_FILENAME
        ).as_posix()
        await self.exec_as_agent(
            environment,
            command=(
                "export PATH=\"$HOME/.bun/bin:$PATH\"; "
                f"mc --json -p {shlex.quote(instruction)} </dev/null "
                f">{shlex.quote(stdout_path)} "
                f"2>{shlex.quote(stderr_path)}"
            ),
        )
