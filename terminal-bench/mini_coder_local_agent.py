from __future__ import annotations

import subprocess
from pathlib import Path
from tempfile import TemporaryDirectory

from harbor.environments.base import BaseEnvironment

from mini_coder_agent import MiniCoderAgent


class MiniCoderLocalAgent(MiniCoderAgent):
    """Harbor installed-agent wrapper for the current local mini-coder checkout."""

    def __init__(self, *args, version: str = "local", **kwargs):
        super().__init__(*args, version=version, **kwargs)
        self._host_repo_root = Path(__file__).resolve().parent.parent

    @staticmethod
    def name() -> str:
        return "mini-coder-local"

    def _require_host_checkout(self) -> None:
        missing: list[str] = []
        for path in (
            self._host_repo_root / "package.json",
            self._host_repo_root / "bin" / "mc.ts",
            self._host_repo_root / "src",
        ):
            if not path.exists():
                missing.append(str(path))
        if missing:
            raise FileNotFoundError(
                "Missing local mini-coder checkout files required for the Harbor run: "
                + ", ".join(missing)
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
            raise RuntimeError(
                "bun is required on the host to package the local mini-coder checkout"
            ) from exc

        if result.returncode != 0:
            details = result.stderr.strip() or result.stdout.strip() or "unknown error"
            raise RuntimeError(
                f"Failed to package the local mini-coder checkout: {details}"
            )
        if not tarball_path.is_file():
            raise RuntimeError(
                f"Expected local mini-coder package tarball at {tarball_path}"
            )

        return tarball_path

    async def install(self, environment: BaseEnvironment) -> None:
        self._require_host_checkout()
        await self._install_system_dependencies(environment)
        await self._install_bun(environment)

        with TemporaryDirectory(prefix="mini-coder-harbor-") as temp_dir:
            tarball_path = self._package_local_checkout(Path(temp_dir))
            container_tarball_path = f"/tmp/{tarball_path.name}"
            await environment.upload_file(tarball_path, container_tarball_path)
            await self._install_global_package(
                environment,
                container_tarball_path,
                ignore_scripts=True,
            )
