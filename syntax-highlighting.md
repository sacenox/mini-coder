# We want to support coloring, or highlighting the syntaxes envolved in mini-coder

This is a problem that `tree-sitter` was made for, and it's used in `nvim` which I use and can
see it's quite an efficient and fast implementation. This should be enough to tokenize the syntaxes.

## How

The intent is to use tree-sitter in some way to provide the tokenized tree using one of their `Language`s. Then we implement a module that wraps each token in ansi codes for rendering.
Some changes to how we render already landed, so we can wait for closing blocks and control when to flush.

The live preview stays unstyled. We only highlight once on commit to scrollback. No incremental logic.

If this works well, we should also replace the diff coloring we hand rolled and use tree sitter based highlighting as well. No need for two way to highlight.

We might add more themes in the future. For now TokyoNight dark only.

## Guardrails

- Do not format or render the markdown into special chars. Syntax highlighting only

## References:

- https://github.com/tree-sitter/node-tree-sitter old it seems and likely unmaintained. But seems to be the api we want, string goes in with syntax, tree comes out. No typescript types afaik.
- https://github.com/tree-sitter/tree-sitter/tree/master/lib the actual C11 library. We might need it, it has `binding_web` might be what we need, the WASM (last activity 2 weeks ago, seems more alive).
- https://github.com/wixdaq is the author of the Popular TokyoNight theme, I want to use this pallete for our default theme.

