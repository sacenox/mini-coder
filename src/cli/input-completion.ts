import {
  getAtCompletions,
  getCommandCompletions,
  getFilePathCompletions,
} from "./completions.ts";

interface InputCompletion {
  completions: string[];
  replaceFrom: number;
}

export async function getInputCompletion(
  beforeCursor: string,
  cursor: number,
  cwd: string,
): Promise<InputCompletion | null> {
  // 1) Command completion: `/...`
  if (beforeCursor.startsWith("/")) {
    return {
      completions: getCommandCompletions(beforeCursor, cwd),
      replaceFrom: 0,
    };
  }

  // 2) @ reference completion: `@...`
  const atMatch = beforeCursor.match(/@(\S*)$/);
  if (atMatch) {
    const query = atMatch[0] ?? "";
    return {
      completions: await getAtCompletions(query, cwd),
      replaceFrom: cursor - query.length,
    };
  }

  // 3) Bare file path completion: complete the current word as a path
  const wordMatch = beforeCursor.match(/(\S+)$/);
  if (wordMatch) {
    const word = wordMatch[1] ?? "";
    return {
      completions: await getFilePathCompletions(word, cwd),
      replaceFrom: cursor - word.length,
    };
  }

  return null;
}
