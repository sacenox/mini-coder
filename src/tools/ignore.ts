import { join } from "node:path";
import ignore from "ignore";

export async function loadGitignore(
	cwd: string,
): Promise<ReturnType<typeof ignore> | null> {
	try {
		const gitignore = await Bun.file(join(cwd, ".gitignore")).text();
		return ignore().add(gitignore);
	} catch {
		return null;
	}
}
