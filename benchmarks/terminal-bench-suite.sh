PYTHONPATH="$PWD" harbor run -y \
   --job-name "terminal-bench-suite-$(date +%F__%H-%M-%S)" \
   --jobs-dir "$PWD/benchmarks/jobs" \
   --dataset terminal-bench/terminal-bench-2 \
   --agent-import-path benchmarks.local-harbor-agent:LocalMiniCoderAgent \
   --n-attempts 2 \
   --n-concurrent 2 \
   --max-retries 0
