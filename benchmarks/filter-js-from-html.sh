PYTHONPATH="$PWD" harbor run -y \
   --job-name "filter-js-from-html-$(date +%F__%H-%M-%S)" \
   --jobs-dir "$PWD/benchmarks/jobs" \
   --dataset terminal-bench/terminal-bench-2 \
   --include-task-name terminal-bench/filter-js-from-html \
   --agent-import-path benchmarks.local-harbor-agent:LocalMiniCoderAgent \
   --n-attempts 4 \
   --n-concurrent 2 \
   --max-retries 0