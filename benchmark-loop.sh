#!/usr/bin/env bash
set -euo pipefail

stop() {
  echo "stopping loop"
  exit 0
}

trap stop INT TERM

while :; do
  echo ""
  echo "> Running step"
  echo ""
  mc -p "See BENCHMARK.md and PROGRESS.md first. Do the next step in the process. Once the step is complete update PROGRESS.md"

  sleep 60
done

