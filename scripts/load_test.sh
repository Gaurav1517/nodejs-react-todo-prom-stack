
#!/usr/bin/env bash
# Simple load generator: parallel curl loops
# Usage: ./load_test.sh <duration_seconds> <parallel_clients>
DURATION=${1:-60}
CLIENTS=${2:-50}
URL=${3:-http://localhost:4000/api/todos}

echo "Generating load: ${CLIENTS} clients for ${DURATION}s against ${URL}"
end=$((SECONDS + DURATION))

worker() {
  while [ $SECONDS -lt $end ]; do
    # POST a small todo
    curl -s -X POST -H 'Content-Type: application/json' -d '{"title":"load-$(date +%s%N)"}' ${URL} >/dev/null
    # GET todos
    curl -s ${URL} >/dev/null
  done
}

for i in $(seq 1 $CLIENTS); do
  worker &
done

wait
echo "Load test finished."
