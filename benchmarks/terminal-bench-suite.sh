PYTHONPATH="$PWD" harbor run -y \
   --job-name "terminal-bench-suite-$(date +%F__%H-%M-%S)" \
   --jobs-dir "$PWD/benchmarks/jobs" \
   --dataset terminal-bench@2.0 \
   --agent-import-path benchmarks.local-harbor-agent:LocalMiniCoderAgent \
   -k 5 \
   --n-concurrent 1 \
   --model openai-codex/gpt-5.5 \
   --mounts-json '[{"type":"bind","source":"/home/xonecas/.config/mini-coder","target":"/root/.config/mini-coder","bind":{"create_host_path":false}}]'
