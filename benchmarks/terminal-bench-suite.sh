PYTHONPATH="$PWD" harbor run -y \
   --job-name "terminal-bench-suite-$(date +%F__%H-%M-%S)" \
   --jobs-dir "$PWD/benchmarks/jobs" \
   --dataset terminal-bench/terminal-bench-2 \
   --agent-import-path benchmarks.local-harbor-agent:LocalMiniCoderAgent \
   --model openai-codex/gpt-5.5 \
   --n-attempts 1 \
   --n-concurrent 2 \
   --max-retries 1 \
   --mounts-json '[{"type":"bind","source":"/home/xonecas/.config/mini-coder","target":"/root/.config/mini-coder","bind":{"create_host_path":false}}]'