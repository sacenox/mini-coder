export async function updateMiniCoder(): Promise<void> {
  console.log("Updating mini-coder...");

  const proc = Bun.spawn(["bun", "add", "-g", "mini-coder@latest"], {
    stdout: "inherit",
    stderr: "inherit",
  });
  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    throw new Error(`Update failed with exit code ${exitCode}`);
  }

  console.log("mini-coder updated.");
}
