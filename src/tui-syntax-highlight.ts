import {
  SyntaxHighlight,
  type SyntaxHighlightProps,
} from "@cel-tui/components";
import type { ContainerNode } from "@cel-tui/types";

type CacheEntry = {
  content: string;
  language: string;
  themeKey: string;
  node: ContainerNode;
};

// We don't care about cache size for now. When we have sessions
// We need to clear cache between sessions.
const cache = new Map<string, CacheEntry>();

function getThemeKey(props?: SyntaxHighlightProps): string {
  return JSON.stringify(props?.theme ?? null);
}

export function memoizedSyntaxHighlight(
  messageKey: string,
  content: string,
  language = "markdown",
  props?: SyntaxHighlightProps,
): ContainerNode {
  const themeKey = getThemeKey(props);
  const cached = cache.get(messageKey);

  if (
    cached &&
    cached.content === content &&
    cached.language === language &&
    cached.themeKey === themeKey
  ) {
    return cached.node;
  }

  const node = SyntaxHighlight(content, language, props);

  cache.set(messageKey, {
    content,
    language,
    themeKey,
    node,
  });

  return node;
}

export function clearSyntaxHighlightCache(): void {
  cache.clear();
}
