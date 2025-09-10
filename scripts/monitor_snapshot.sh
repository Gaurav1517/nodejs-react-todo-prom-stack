
#!/usr/bin/env bash
# Collect system stats and Prometheus metrics snapshots.
# Usage: ./monitor_snapshot.sh before|after <output_dir>
MODE=$1
OUT=${2:-./monitor-$(date +%Y%m%d-%H%M%S)}
mkdir -p "$OUT"

echo "Mode: $MODE -> saving to $OUT"

echo "=== top ===" > "$OUT/top.txt"
top -b -n1 >> "$OUT/top.txt" 2>&1

echo "=== free -m ===" > "$OUT/free.txt"
free -m >> "$OUT/free.txt" 2>&1

echo "=== vmstat ===" > "$OUT/vmstat.txt"
vmstat 1 5 >> "$OUT/vmstat.txt" 2>&1

echo "=== docker stats ===" > "$OUT/docker_stats.txt"
docker stats --no-stream >> "$OUT/docker_stats.txt" 2>&1 || echo "docker stats failed" >> "$OUT/docker_stats.txt"

# Query Prometheus metrics
PROM="http://localhost:9090"
QUERIES=(
  "sum(todo_count)"
  "rate(http_request_duration_seconds_count[5m])"
  "100 - (avg by (instance) (rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100)"
  "node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes * 100"
)
mkdir -p "$OUT/prometheus"
for q in "${QUERIES[@]}"; do
  safe=$(echo $q | sed 's/[^a-zA-Z0-9]/_/g')
  curl -sG --data-urlencode "query=$q" "$PROM/api/v1/query" > "$OUT/prometheus/${safe}.json"
done

echo "Saved snapshots to $OUT"
