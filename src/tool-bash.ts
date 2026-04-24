import { type Tool, Type } from "@mariozechner/pi-ai";
import { secureRandomString } from "./shared";

const OUTPUT_THRESHOLD = 10000;
const description = `## Bash CLI tool

Best practices using this tool:

- Use \`ls\` to list files.
- Use \`fd\` or \`find\` to locate files/directories by name, type, size, time, permissions, etc.
- Use \`rg\` or \`grep\` to search inside files for matching patterns.
- Use \`cat -n\` or \`nl\` to read small files, or when you need the whole file.
- Use \`sed -n\` with ranges to read sections of files. Prefer targeted reads, avoid dumping very large (more than ~200 lines) files all at once.
- Use \`sed -i\` for exact edits and \`cat\` with redirection for new files. Prefer patch-based edits for multi-line or semantic changes.
- Use \`cp\`, \`mv\`, and \`mkdir\` for file and directory operations, and \`rm\` to remove files and directories.
- Use \`curl\` for web access. Use redirection to temp files for targeted reads.
- Use development tools, like \`git\`, \`gh\`, \`jq\`, etc, when appropriate.
- Prefer \`cp -i\`, \`mv -i\`, \`rm -i\` when learning
- Be careful with destructive actions, and overwriting existing unsaved work.
- Chain commands only when failure should stop the flow.
- Avoid overly complex one-liners, readability matters.
- Quote filenames: use \`"$file"\` not \`$file\`
- Be careful with spaces in filenames

Current working directory: ${process.cwd()}
`;

export const bash: Tool = {
  name: "bash",
  description:
    "This is your command line, run commands in your user's environment.",
  parameters: Type.Object({
    command: Type.String({
      description,
    }),
  }),
};

export async function runBashTool(args: Record<string, any>) {
  const proc = Bun.spawn(["bash", "-c", args.command], {
    stdout: "pipe",
    stderr: "pipe",
  });
  await proc.exited;
  const stdout = (await proc.stdout.text()).trim();
  const stderr = (await proc.stderr?.text())?.trim();

  let out = `# EXIT CODE: ${proc.exitCode}`;
  if (stderr.length) {
    out += `
# STDERR:

${stderr}`;
  }
  if (stdout.length) {
    out += `
# STDOUT:

${stdout}`;
  }

  // If `out` is too big, more than ~10KB, write it to a temp file
  // And add that to the truncation label for the agent to be able
  // to continue the read with scans. This is to protect context,
  // not a general read guard. The hint is for the agent, not the TUI
  if (out.length > OUTPUT_THRESHOLD) {
    const key = `${Date.now()}-${secureRandomString(4)}`;
    const pathname = `/tmp/bash_result_${key}.txt`;
    await Bun.write(pathname, out);
    out = `${out.substring(0, OUTPUT_THRESHOLD)}

Truncated at ${OUTPUT_THRESHOLD}. Full output at ${pathname}`;
  }

  return out;
}
