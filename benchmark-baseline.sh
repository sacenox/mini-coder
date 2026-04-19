#!/usr/bin/env bash
set -euo pipefail

cd -- "$(dirname -- "${BASH_SOURCE[0]}")"

PYTHONPATH="$PWD/terminal-bench" harbor run -y \
  --job-name benchmark-baseline-full-$(date +%F__%H-%M-%S) \
  --jobs-dir "$PWD/terminal-bench/jobs" \
  --agent-import-path mini_coder_agent:MiniCoderAgent \
  --ak version=0.5.12 \
  --model openai-codex/gpt-5.4 \
  --dataset terminal-bench@2.0 \
  --n-attempts 2 \
  --n-concurrent 2 \
  --max-retries 0
