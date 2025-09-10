
# React + NodeJS TODO App with Prometheus + Loki + Grafana + Node Exporter

This stack includes:
- React frontend (Vite) served by nginx
- Node.js backend (Express + MongoDB) exposing Prometheus metrics at /metrics
- Prometheus (scrapes backend & node_exporter)
- Loki (logs)
- Promtail (ships logs from ./logs to Loki)
- Grafana (datasource: Prometheus + Loki; dashboard included)
- node_exporter (host metrics)

## How to run
1. Install Docker & Docker Compose.
2. From this folder run:
   ```bash
   docker-compose up --build -d
   ```
3. Endpoints:
   - Frontend: http://localhost:3000
   - Backend API: http://localhost:4000/api/todos
   - Prometheus: http://localhost:9090
   - Loki (API): http://localhost:3100
   - Grafana: http://localhost:4001 (user: admin / pass: admin)

## Logging & Loki
- Backend writes logs to `/var/log/backend.log` inside container; compose mounts `./logs` so Promtail can read it.
- Promtail config (`promtail/promtail-config.yaml`) is set to read `./logs/*.log` and push to Loki at http://loki:3100

## Load testing and monitoring scripts
- `scripts/load_test.sh` — generate high traffic using parallel curl loops.
- `scripts/monitor_snapshot.sh` — collect system stats (top, free, vmstat, docker stats) before and after load and query Prometheus for specific metrics.
- Run `scripts/monitor_snapshot.sh before` then `scripts/load_test.sh` then `scripts/monitor_snapshot.sh after` to record differences.

Note: I cannot execute these scripts on your machine. Run them locally after bringing up the stack.
