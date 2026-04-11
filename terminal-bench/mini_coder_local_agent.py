from __future__ import annotations

import subprocess
import tempfile
from pathlib import Path

from harbor.environments.base import BaseEnvironment

from mini_coder_agent import MiniCoderAgent


class MiniCoderLocalAgent(MiniCoderAgent):
    """Harbor installed-agent wrapper for the current local mini-coder checkout."""

    def __init__(self, *args, version: str = "local-checkout", **kwargs):
        super().__init__(*args, version=version, **kwargs)
        self._repo_root = Path(__file__).resolve().parent.parent

    @staticmethod
    def name() -> str:
        return "mini-coder-local"

    def _pack_local_checkout(self, output_dir: Path) -> Path:
        tarball_name = "mini-coder-local.tgz"
        tarball_path = output_dir / tarball_name
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
                cwd=self._repo_root,
                check=False,
                capture_output=True,
                text=True,
            )
        except FileNotFoundError as error:
            raise RuntimeError(
                "bun is required on the host to pack the current mini-coder checkout"
            ) from error

        if result.returncode != 0:
            raise RuntimeError(
                "Failed to pack the current mini-coder checkout for Harbor.\n"
                f"stdout:\n{result.stdout}\n"
                f"stderr:\n{result.stderr}"
            )
        if not tarball_path.is_file():
            raise RuntimeError(
                f"bun pm pack did not create the expected tarball: {tarball_path}"
            )
        return tarball_path

    async def install(self, environment: BaseEnvironment) -> None:
        await self._install_system_dependencies(environment)
        await self._install_bun(environment)

        with tempfile.TemporaryDirectory(
            prefix="mini-coder-terminal-bench-"
        ) as output_dir:
            tarball_path = self._pack_local_checkout(Path(output_dir))
            container_tarball_path = f"/tmp/{tarball_path.name}"
            await environment.upload_file(tarball_path, container_tarball_path)
            await self._install_global_package(
                environment,
                container_tarball_path,
                ignore_scripts=True,
            )
