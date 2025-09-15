#!/usr/bin/env bash
# scripts/load_test.sh <duration_seconds> <max_clients> <url>
DURATION=${1:-60}
MAX_CLIENTS=${2:-50}
URL=${3:-http://localhost:4000/api/todos}

# Simple ramp-up/ramp-down generator using curl in background loops
echo "Load test: duration=${DURATION}s max_clients=${MAX_CLIENTS} target=${URL}"

end=$((SECONDS + DURATION))

# Ramp-up: quickly start clients up to MAX_CLIENTS
for ((c=1;c<=MAX_CLIENTS;c++)); do
  (
    while [ $SECONDS -lt $end ]; do
      # post a small todo
      curl -s -X POST -H 'Content-Type: application/json' -d "{\"title\":\"load-$(date +%s%N)\"}" "${URL}" > /dev/null 2>&1
      # get list
      curl -s "${URL}" > /dev/null 2>&1
      sleep 0.1
    done
  ) &
  # small gap to ramp up
  sleep 0.1
done

# Wait for duration
wait
echo "Load test finished"
