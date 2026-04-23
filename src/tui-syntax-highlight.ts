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

const cache = new Map<string, CacheEntry>();
const MAX_ENTRIES = 200;

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

  // tiny FIFO cap so cache doesn't grow forever
  if (cache.size > MAX_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey !== undefined) {
      cache.delete(oldestKey);
    }
  }

  return node;
}

export function clearSyntaxHighlightCache(): void {
  cache.clear();
}
