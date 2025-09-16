# NodeJS + React TODO App — Observability Stack (Prometheus, Grafana, Loki, Alertmanager)

> Full-stack Todo app instrumented with Prometheus metrics, Loki logs, Grafana dashboards, Alertmanager for email alerts, and a load-testing utility.
> This README is written as a DevOps / SRE guide — step-by-step configuration, annotated file explanations, and detailed troubleshooting.

---

## Table of contents

1. [Quick summary & project layout](#quick-summary--project-layout)
2. [Prerequisites & host setup](#prerequisites--host-setup)
3. [Environment variables (`.env`)](#environment-variables-env)
4. [Docker Compose & how to build/run the stack](#docker-compose--how-to-buildrun-the-stack)
5. [Files & line-by-line explanation](#files--line-by-line-explanation)

   * `docker-compose.yml`
   * `prometheus/prometheus.yml` and `prometheus/alerts.yml`
   * `alertmanager/alertmanager.yml`
   * `loki/local-config.yaml`
   * `promtail/promtail-config.yaml`
   * `backend/Dockerfile` & `backend/server.js` (instrumentation, CORS, logging)
   * `frontend/Dockerfile` & `frontend/src/App.jsx` (Vite env)
   * `scripts/load_test.sh`
   * `grafana/` provisioning & dashboards
6. [Prometheus queries & Grafana panels (examples)](#prometheus-queries--grafana-panels-examples)
7. [Alert rules (example) and Alertmanager flow](#alert-rules-example-and-alertmanager-flow)
8. [Loki permissions and common errors](#loki-permissions-and-common-errors)
9. [Common troubleshooting & solutions (CORS, SMTP, env, firewall, DB, node\_exporter)](#common-troubleshooting--solutions)
10. [How to inspect DB & logs, check endpoints, verify metrics](#how-to-inspect-db--logs-check-endpoints-verify-metrics)
11. [Appendix: useful commands & examples](#appendix-useful-commands--examples)

---

## Quick summary & project layout

This project contains:

```
.
├── backend/                 # Node.js backend (Express)
│   ├── Dockerfile
│   ├── package.json
│   └── server.js
├── frontend/                # React (Vite) frontend, served by Nginx
│   ├── Dockerfile
│   ├── package.json
│   └── src/App.jsx
├── prometheus/
│   ├── prometheus.yml
│   └── alerts.yml
├── grafana/
│   ├── provisioning/
│   └── dashboards/
├── loki/
│   └── local-config.yaml
├── promtail/
│   └── promtail-config.yaml
├── alertmanager/
│   └── alertmanager.yml
├── scripts/
│   └── load_test.sh
└── docker-compose.yml
```

Services run through `docker compose`:

* `mongo`, `backend`, `frontend`, `prometheus`, `grafana`, `loki`, `promtail`, `node_exporter`, `mongodb_exporter`, `alertmanager`.

---

## Prerequisites & host setup

1. **Docker & Docker Compose** (Docker plugin on modern systems):

   * RHEL / CentOS / Fedora (example):

     ```bash
     sudo dnf -y install dnf-plugins-core
     sudo dnf config-manager --add-repo https://download.docker.com/linux/rhel/docker-ce.repo
     sudo dnf install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
     sudo systemctl enable --now docker
     docker --version
     docker compose version
     ```

2. **Open required firewall ports** (example `firewalld` commands):

   ```bash
   sudo firewall-cmd --permanent --add-port=9090/tcp   # Prometheus
   sudo firewall-cmd --permanent --add-port=4000/tcp   # Backend
   sudo firewall-cmd --permanent --add-port=3000/tcp   # Grafana (or 4001 if remapped)
   sudo firewall-cmd --permanent --add-port=3100/tcp   # Loki
   sudo firewall-cmd --permanent --add-port=9093/tcp   # Alertmanager
   sudo firewall-cmd --permanent --add-port=9100/tcp   # node_exporter
   sudo firewall-cmd --permanent --add-port=9216/tcp   # mongodb exporter
   sudo firewall-cmd --permanent --add-port=27017/tcp  # MongoDB (if you want remote access)
   sudo firewall-cmd --permanent --add-port=587/tcp    # SMTP (outbound)
   sudo firewall-cmd --reload
   ```

3. Optional SELinux booleans if SELinux active (for sending mail):

   ```bash
   sudo setsebool -P nis_enabled 1
   sudo setsebool -P httpd_can_sendmail 1   
   ```

![](/snap/docker-compose-install-firewall-dir.png)
---

## Environment variables (`.env`)

Create a `.env` file in repo root used by `docker-compose` and containers:

```env
# Frontend will talk to backend API
VITE_API_URL=http://192.168.44.132:4000/api

# Alertmanager / Grafana SMTP (Gmail example)
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-google-app-password   # continuous string, no spaces
ALERT_RECEIVER=receiver-email@gmail.com
```

**Important**: Gmail app password is a single continuous string (no spaces). Example: `SMTP_PASS=abcdxyztuvwx1234` — not `abcd xyz ...`.

---

## Docker Compose & how to build/run the stack

**Recommended docker-compose changes** (short explanation follows in the file-by-file section):

* Use one `docker-compose.yml` in repo root.
* Build `backend` using `context: .` and `dockerfile: backend/Dockerfile` so `scripts/` is in build context and can be copied into image.
* Build `frontend` with build arg `VITE_API_URL` and the Dockerfile writes that into `.env` inside the build step for Vite to pick it up.

**Start the full stack**:

```bash
# from repo root
docker compose up --build -d
```
![](/snap/docker-compose-up.png)

**Check running containers**:

```bash
docker compose ps
# or
docker ps --format "table {{.Names}}\t{{.Image}}\t{{.Status}}"
```
![](/snap/docker-compose-ps.png)

**View logs**:

```bash
docker compose logs -f backend
docker compose logs -f loki
docker compose logs -f promtail
docker compose logs -f prometheus
docker compose logs -f grafana
```

---

## Files — line-by-line / block-by-block explanation

Below I walk through the important files and show recommended configuration snippets and why each line exists.

> NOTE: I show canonical/updated examples. Use these exact snippets if you had problems (copy/paste).

---

### `docker-compose.yml` — annotated

This example uses the repo root as a build context for backend so `scripts/load_test.sh` is accessible to Docker build.

```yaml
version: "3.8"

services:
  mongo:
    image: mongo:6
    container_name: mongo
    restart: unless-stopped
    volumes:
      - mongo-data:/data/db
    ports:
      - "27017:27017"

  backend:
    build:
      context: .                 # IMPORTANT: project root so COPY scripts/ works
      dockerfile: backend/Dockerfile
    container_name: backend
    restart: unless-stopped
    environment:
      - MONGO_URI=mongodb://mongo:27017/todoapp
      - PORT=4000
      - LOAD_TEST_URL=http://backend:4000/api/todos
    depends_on:
      - mongo
    volumes:
      - ./logs:/var/log         # expose logs to host for Promtail
    ports:
      - "4000:4000"

  frontend:
    build:
      context: ./frontend
      dockerfile: Dockerfile
      args:
        VITE_API_URL: ${VITE_API_URL}
    container_name: frontend
    restart: unless-stopped
    ports:
      - "3000:80"
    depends_on:
      - backend
    env_file:
      - ./.env

  prometheus:
    image: prom/prometheus:v2.52.0
    container_name: prometheus
    volumes:
      - ./prometheus/prometheus.yml:/etc/prometheus/prometheus.yml:ro
      - ./prometheus/alerts.yml:/etc/prometheus/alerts.yml:ro
    ports:
      - "9090:9090"
    command:
      - '--config.file=/etc/prometheus/prometheus.yml'
      - '--web.enable-lifecycle'
    restart: unless-stopped
    depends_on:
      - alertmanager

  alertmanager:
    image: prom/alertmanager:v0.27.0
    container_name: alertmanager
    volumes:
      - ./alertmanager/alertmanager.yml:/etc/alertmanager/alertmanager.yml:ro
    ports:
      - "9093:9093"
    env_file:
      - ./.env
    restart: unless-stopped

  loki:
    image: grafana/loki:2.8.2
    container_name: loki
    command: -config.file=/etc/loki/local-config.yaml
    ports:
      - "3100:3100"
    volumes:
      - ./loki/local-config.yaml:/etc/loki/local-config.yaml:ro
      - ./loki-data:/loki
    restart: unless-stopped

  promtail:
    image: grafana/promtail:2.8.2
    container_name: promtail
    volumes:
      - ./promtail/promtail-config.yaml:/etc/promtail/promtail-config.yaml:ro
      - ./logs:/var/log:ro
      - /var/lib/docker/containers:/var/lib/docker/containers:ro
      - /var/log:/var/log:ro
    command: -config.file=/etc/promtail/promtail-config.yaml
    restart: unless-stopped

  grafana:
    image: grafana/grafana-oss:10.1.0
    container_name: grafana
    user: "472"
    volumes:
      - ./grafana/provisioning/:/etc/grafana/provisioning/
      - ./grafana/dashboards/:/var/lib/grafana/dashboards/
    environment:
      - GF_SECURITY_ADMIN_PASSWORD=admin
      # Optional: configure Grafana SMTP if you want Grafana itself to send emails
      - GF_SMTP_ENABLED=true
      - GF_SMTP_HOST=smtp.gmail.com:587
      - GF_SMTP_USER=${SMTP_USER}
      - GF_SMTP_PASSWORD=${SMTP_PASS}
      - GF_SMTP_FROM_ADDRESS=${SMTP_USER}
      - GF_SMTP_SKIP_VERIFY=true
    env_file:
      - ./.env
    ports:
      - "4001:3000"
    restart: unless-stopped
    depends_on:
      - prometheus
      - loki

  node_exporter:
    image: prom/node-exporter:latest
    container_name: node_exporter
    restart: unless-stopped
    ports:
      - "9100:9100"

  mongodb_exporter:
    image: bitnami/mongodb-exporter:latest
    container_name: mongodb_exporter
    environment:
      - MONGODB_URI=mongodb://mongo:27017
    ports:
      - "9216:9216"
    restart: unless-stopped
    depends_on:
      - mongo

volumes:
  mongo-data:
  loki-data:
```

**Important notes:**

* `backend.build.context: .` makes `./scripts/` available during the backend Docker build — solves the `COPY scripts/load_test.sh: not found` error you saw.
* `./logs:/var/log` volume allows Promtail to read backend logs for Loki ingestion.
* `loki-data` mounted to `./loki-data` is persistent; see Loki permissions below.

---

### `prometheus/prometheus.yml` — annotated

Use service names in the docker network for Prometheus to reach other services **inside Docker**. If you prefer host IPs, use `192.168.x.x:port` (but service names are recommended when using Compose).

```yaml
global:
  scrape_interval: 15s
  evaluation_interval: 15s

alerting:
  alertmanagers:
    - static_configs:
        - targets: ['alertmanager:9093']   # Prometheus will send alerts here

rule_files:
  - /etc/prometheus/alerts.yml             # alert rules loaded from file mounted in compose

scrape_configs:
  - job_name: 'backend'
    static_configs:
      - targets: ['backend:4000']          # backend /metrics endpoint

  - job_name: 'node_exporter'
    static_configs:
      - targets: ['node_exporter:9100']    # node_exporter service

  - job_name: 'prometheus'
    static_configs:
      - targets: ['prometheus:9090']

  - job_name: 'mongodb'
    static_configs:
      - targets: ['mongodb_exporter:9216']
```

**If you used host IPs previously**, you may have mixed targets (`192.168.44.132:9100`) — ensure `node_exporter` is reachable at that IP/port or change to `node_exporter:9100` if running as container.

---

### `prometheus/alerts.yml` (example alert group)

Create or update `prometheus/alerts.yml`:

```yaml
groups:
- name: todo-alerts
  rules:
  - alert: HighCPUUsage
    expr: 1 - avg by (instance) (rate(node_cpu_seconds_total{mode="idle"}[5m])) > 0.80
    for: 2m
    labels:
      severity: critical
      alertname: cpu-mem-alert
    annotations:
      summary: "High CPU usage on {{ $labels.instance }}"
      description: "CPU usage > 80% for more than 2 minutes."

  - alert: HighMemoryUsage
    expr: (1 - (node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes)) > 0.80
    for: 2m
    labels:
      severity: critical
      alertname: cpu-mem-alert
    annotations:
      summary: "High Memory usage on {{ $labels.instance }}"
      description: "Memory usage > 80% for more than 2 minutes."
```

**Explanation**:

* `expr` for CPU computes non-idle CPU fraction.
* For memory, we use `MemAvailable/Total` to compute available memory fraction; then invert to get usage.

Prometheus will evaluate and forward alerts to Alertmanager (configured above).

---

### `alertmanager/alertmanager.yml` — annotated

```yaml
global:
  smtp_smarthost: 'smtp.gmail.com:587'
  smtp_from: '${SMTP_USER}'
  smtp_auth_username: '${SMTP_USER}'
  smtp_auth_password: '${SMTP_PASS}'
  smtp_require_tls: true

route:
  receiver: email-team
  group_wait: 30s
  group_interval: 5m
  repeat_interval: 1h

receivers:
  - name: email-team
    email_configs:
      - to: '${ALERT_RECEIVER}'
        send_resolved: true
```

**Notes**:

* I recommend storing credentials in `.env` and using `env_file` in Compose to inject them (already set earlier).
* For Gmail, you must use an **App Password** (if your account uses 2FA). The `SMTP_PASS` should be that app password (a continuous string).

---

### `loki/local-config.yaml` — annotated (filesystem mode)

Minimal filesystem (single-node) Loki config:

```yaml
auth_enabled: false

server:
  http_listen_port: 3100

ingester:
  wal:
    enabled: true
    dir: /loki/wal

memberlist:
  join_members: ["loki"]

schema_config:
  configs:
    - from: 2020-10-24
      store: boltdb-shipper
      object_store: filesystem
      schema: v11
      index:
        prefix: index_
        period: 24h

storage_config:
  boltdb_shipper:
    active_index_directory: /loki/index
    cache_location: /loki/boltdb-cache
    shared_store: filesystem
  filesystem:
    directory: /loki/chunks

limits_config:
  ingestion_rate_mb: 10
  ingestion_burst_size_mb: 20
```

**Important**: Loki writes to `/loki` inside the container — ensure `./loki-data` on the host is created and writable by Loki (see `Loki permissions` section).

---

### `promtail/promtail-config.yaml` — annotated

This config instructs Promtail to tail the backend log file (`/var/log/backend.log`) and push to Loki.

Example:

```yaml
server:
  http_listen_port: 9080
  grpc_listen_port: 0

positions:
  filename: /tmp/positions.yaml

clients:
  - url: http://loki:3100/loki/api/v1/push

scrape_configs:
  - job_name: system
    static_configs:
      - targets:
          - localhost
        labels:
          job: varlogs
          __path__: /var/log/*.log
```

**Important**: `./logs` is mounted into backend at `/var/log`, and `promtail` mounts the same host directory read-only so the logs are visible to Promtail.

---

### `backend/Dockerfile` — to include `scripts/load_test.sh` in image

Put this `Dockerfile` at `backend/Dockerfile`:

```dockerfile
FROM node:18-alpine
WORKDIR /usr/src/app

# copy package.json and install
COPY backend/package*.json ./
RUN npm install --production

# copy backend app files
COPY backend/ .

# make sure scripts in repo root are available in build context (see compose)
# If compose uses context: . and dockerfile: backend/Dockerfile, the repo root is build context
COPY scripts/load_test.sh /app/load_test.sh
RUN chmod +x /app/load_test.sh

# create log dir
RUN mkdir -p /var/log

# install bash & curl for load script
RUN apk add --no-cache bash curl

EXPOSE 4000
CMD ["node", "server.js"]
```

**Why this matters**:

* Your earlier error `COPY ../scripts/load_test.sh ... not found` was because the Docker build context didn't include the `scripts` folder. The fix is to set `context: .` in `docker-compose.yml` (project root) and `dockerfile: backend/Dockerfile`.

---

### `backend/server.js` — annotated (instrumentation + loki logging + CORS + body parsing)

Below is a recommended server implementation with:

* `bodyParser` / JSON parsing
* Prometheus metrics: `http_request_duration_seconds`, `http_requests_total`, `todos_created_total`, `todos_deleted_total`, `todos_completed_total`, `todo_count`
* Logging with `morgan` + `winston-loki` transport + file
* CORS friendly to your host IP & `localhost`

**Important**: This file will already exist in your repo. If you had CORS errors earlier, ensure `app.use(bodyParser.json())` is present and the `cors()` configuration matches allowed origins.

Large, annotated example (you can replace your `backend/server.js` with this):

```js
// backend/server.js
const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const promClient = require('prom-client');
const morgan = require('morgan');
const cors = require('cors');
const fs = require('fs-extra');
const path = require('path');
const winston = require('winston');
const LokiTransport = require('winston-loki');
const { spawn } = require('child_process');

const app = express();
const port = process.env.PORT || 4000;
const mongoUri = process.env.MONGO_URI || 'mongodb://mongo:27017/todoapp';

// Ensure log directory
fs.ensureDirSync('/var/log');

// create a write stream for HTTP access logging
const accessLogStream = fs.createWriteStream('/var/log/access.log', { flags: 'a' });

// Setup winston logger and loki transport
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.printf(info => `[${info.timestamp}] ${info.level.toUpperCase()}: ${info.message}`)
  ),
  transports: [
    new LokiTransport({
      host: 'http://loki:3100',     // Loki service in compose
      labels: { app: 'todo-app', service: 'backend' },
      json: true,
      replaceTimestamp: true
    }),
    new winston.transports.Console(),
    new winston.transports.File({ filename: '/var/log/backend.log' })
  ]
});

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(morgan('combined', { stream: accessLogStream }));
app.use(morgan('combined', { stream: { write: (msg) => logger.info(msg.trim()) } }));

// CORS: allow host IP, frontend host, and localhost. Adjust to your environment.
const allowedOrigins = [
  'http://localhost:3000',
  'http://frontend:3000',           // from other containers
  'http://192.168.44.132:3000'      // host IP
];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      logger.warn('Blocked CORS for origin: ' + origin);
      callback(new Error('CORS not allowed for this origin: ' + origin));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type'],
  credentials: true
}));

// Prometheus metrics
const register = promClient.register;
promClient.collectDefaultMetrics({ register });

const httpRequestDurationSeconds = new promClient.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method','route','code'],
  buckets: [0.005,0.01,0.05,0.1,0.5,1,2,5]
});
const httpRequestsTotal = new promClient.Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method','route','status']
});
const todosCreated = new promClient.Counter({ name: 'todos_created_total', help: 'Total number of todos created' });
const todosDeleted = new promClient.Counter({ name: 'todos_deleted_total', help: 'Total number of todos deleted' });
const todosCompleted = new promClient.Counter({ name: 'todos_completed_total', help: 'Total number of todos completed' });
const todoCount = new promClient.Gauge({ name: 'todo_count', help: 'Number of todos in DB' });

// metrics middleware
app.use((req,res,next) => {
  const end = httpRequestDurationSeconds.startTimer();
  res.on('finish', () => {
    const route = req.route && req.route.path ? req.route.path : req.path;
    httpRequestsTotal.inc({ method: req.method, route, status: res.statusCode });
    end({ method: req.method, route, code: res.statusCode });
    logger.info(`${req.method} ${req.originalUrl} -> ${res.statusCode}`);
  });
  next();
});

// Mongoose model
const todoSchema = new mongoose.Schema({
  title: String,
  done: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});
const Todo = mongoose.model('Todo', todoSchema);

// connect to mongo
mongoose.connect(mongoUri, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => logger.info('MongoDB connected'))
  .catch(err => logger.error('MongoDB connection error: ' + err.message));

// CRUD routes
app.get('/api/health', (req,res) => res.json({status: 'ok'}));

app.get('/api/todos', async (req,res) => {
  try {
    const todos = await Todo.find().sort({ createdAt: -1 });
    todoCount.set(todos.length);
    res.json(todos);
  } catch (e) {
    logger.error('GET /api/todos failed: ' + e.message);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/todos', async (req,res) => {
  try {
    if (!req.body || !req.body.title) return res.status(400).json({ error: 'Title required' });
    const t = new Todo({ title: req.body.title });
    await t.save();
    const count = await Todo.countDocuments();
    todoCount.set(count);
    todosCreated.inc();
    logger.info(`Created todo: ${t.title}`);
    res.status(201).json(t);
  } catch (e) {
    logger.error('POST /api/todos failed: ' + e.message);
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/todos/:id', async (req,res) => {
  try {
    const t = await Todo.findByIdAndUpdate(req.params.id, req.body, { new: true });
    const count = await Todo.countDocuments();
    todoCount.set(count);
    if (req.body.done === true) todosCompleted.inc();
    if (!t) return res.status(404).end();
    res.json(t);
  } catch (e) {
    logger.error('PUT /api/todos/:id failed: ' + e.message);
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/todos/:id', async (req,res) => {
  try {
    await Todo.findByIdAndDelete(req.params.id);
    const count = await Todo.countDocuments();
    todoCount.set(count);
    todosDeleted.inc();
    res.status(204).end();
  } catch (e) {
    logger.error('DELETE /api/todos/:id failed:' + e.message);
    res.status(500).json({ error: e.message });
  }
});

// metrics endpoint
app.get('/metrics', async (req,res) => {
  res.setHeader('Content-Type', register.contentType);
  res.end(await register.metrics());
});

// === Load test endpoints (start/stop/list/log) ===
// NOTE: spawn /app/load_test.sh which was copied during build via Dockerfile
const LoadResultSchema = new mongoose.Schema({
  duration: Number,
  clients: Number,
  url: String,
  startTime: { type: Date, default: Date.now },
  status: { type: String, default: 'running' },
  pid: Number,
  logFile: String,
  output: String
});
const LoadResult = mongoose.model('LoadResult', LoadResultSchema);
const runningTests = new Map();

app.post('/api/load-test', async (req,res) => {
  try {
    const duration = Number(req.body.duration) || 60;
    const clients = Number(req.body.clients) || 10;
    const url = req.body.url || process.env.LOAD_TEST_URL || 'http://localhost:4000/api/todos';

    const test = new LoadResult({ duration, clients, url, status: 'running' });
    await test.save();

    const logFile = `/var/log/load_test_${test._id}.log`;
    test.logFile = logFile;
    await test.save();

    const child = spawn('bash', ['/app/load_test.sh', String(duration), String(clients), url], {
      detached: false,
      stdio: ['ignore','pipe','pipe']
    });

    const outStream = fs.createWriteStream(logFile, { flags: 'a' });
    child.stdout.pipe(outStream);
    child.stderr.pipe(outStream);

    runningTests.set(String(test._id), child);
    test.pid = child.pid;
    await test.save();

    child.on('exit', async (code) => {
      try {
        const doc = await LoadResult.findById(test._id);
        doc.status = code === 0 ? 'completed' : 'failed';
        doc.output = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8').slice(0, 200000) : '';
        doc.pid = null;
        await doc.save();
      } catch (err) {
        logger.error('Error updating load test result: ' + err.message);
      } finally {
        runningTests.delete(String(test._id));
      }
    });

    res.json({ message: 'Load test started', testId: test._id });
  } catch (e) {
    logger.error('Error starting load test: ' + e.message);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/load-test/stop', async (req,res) => {
  try {
    const { testId } = req.body;
    if (!testId) return res.status(400).json({ error: 'testId required' });
    const child = runningTests.get(String(testId));
    if (!child) {
      await LoadResult.findByIdAndUpdate(testId, { status: 'stopped', pid: null });
      return res.json({ message: 'No running process found for this testId' });
    }
    child.kill('SIGINT');
    setTimeout(() => {
      try { process.kill(child.pid, 'SIGKILL'); } catch (e) {}
    }, 5000);
    await LoadResult.findByIdAndUpdate(testId, { status: 'stopped', pid: null });
    runningTests.delete(String(testId));
    res.json({ message: 'Stop signal sent' });
  } catch (e) {
    logger.error('Error stopping load test: ' + e.message);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/load-tests', async (req,res) => {
  try {
    const results = await LoadResult.find().sort({ startTime: -1 }).limit(50);
    res.json(results);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/load-test/:id/log', async (req,res) => {
  try {
    const id = req.params.id;
    const doc = await LoadResult.findById(id);
    if (!doc || !doc.logFile) return res.status(404).send('Log not found');
    if (!fs.existsSync(doc.logFile)) return res.status(404).send('Log file missing on disk');
    const content = fs.readFileSync(doc.logFile, 'utf8');
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.send(content);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(port, () => logger.info(`Backend running on port ${port}`));
```

**Key points:**

* `bodyParser.json()` fixed the `Cannot read properties of undefined (reading 'title')` error you saw on POST — if you did not parse JSON, `req.body` is undefined.
* CORS allowedOrigins must include `http://192.168.44.132:3000` and `http://localhost:3000` and any host the frontend will use.
* `winston-loki` sends structured logs to Loki. Also the concatenation with `morgan` writes a file `access.log` for Promtail.

---

### `frontend/Dockerfile` — inject VITE\_API\_URL build arg for Vite

Vite reads `.env` at build time. This Dockerfile writes a temporary `.env` file with the Vite variable before `npm run build`.

`frontend/Dockerfile`:

```dockerfile
# build stage
FROM node:18-alpine AS build
WORKDIR /app
ARG VITE_API_URL
ENV VITE_API_URL=${VITE_API_URL}
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ .
# generate a .env file Vite will pick up during build
RUN echo "VITE_API_URL=${VITE_API_URL}" > .env
RUN npm run build

# production stage
FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```

**Important**:

* Changing `VITE_API_URL` requires rebuilding the frontend image (`docker compose build frontend`).

---

### `frontend/src/App.jsx` — where to add the load test UI & use env var

Important lines (your file):

```js
const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000/api";
```

**Notes**:

* Vite in production builds in the value at build time. If you changed `.env` after image build, the container will still serve the previously built bundle — you must rebuild.
* The provided UI includes load test controls that call backend `/api/load-test` endpoints. The backend must have `/api/load-test` endpoints (server.js above).

---

### `scripts/load_test.sh` — annotated (ramp up / ramp down)

File path: `scripts/load_test.sh` (must be executable). Example improved script:

```bash
#!/usr/bin/env bash
# scripts/load_test.sh <duration_seconds> <max_clients> <url>
DURATION=${1:-60}
MAX_CLIENTS=${2:-50}
URL=${3:-http://localhost:4000/api/todos}

echo "Load test: duration=${DURATION}s max_clients=${MAX_CLIENTS} target=${URL}"

end=$((SECONDS + DURATION))

# Start MAX_CLIENTS background loops
for ((c=1;c<=MAX_CLIENTS;c++)); do
  (
    while [ $SECONDS -lt $end ]; do
      curl -s -X POST -H 'Content-Type: application/json' -d "{\"title\":\"load-$(date +%s%N)\"}" "${URL}" >/dev/null 2>&1
      curl -s "${URL}" >/dev/null 2>&1
      sleep 0.1
    done
  ) &
  sleep 0.05
done

wait
echo "Load test finished"
```

**Note**: If you want **ramp-down** logic (gradual decrease) you can create more complex loops. This simple variant starts `MAX_CLIENTS` all at once during the duration.

---

### `grafana/provisioning/` & dashboards

You can pre-provision Grafana data sources and dashboard JSON. If you included `grafana/provisioning` and `grafana/dashboards`, Grafana will auto-import them at start. Otherwise, you can import dashboard JSON via Grafana UI.

A sample panel to visualize HTTP request latency and todo counters:

* **Panel 1 — HTTP request duration histogram**
  Prometheus query: `histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket[5m])) by (le))`
* **Panel 2 — Todos created total**
  Query: `rate(todos_created_total[5m])`
* **Panel 3 — Current todo\_count**
  Query: `todo_count`

---

## Prometheus queries & Grafana panels (examples)

* Current number of todos:

  ```
  todo_count
  ```

* Requests/sec (all routes):

  ```
  sum(rate(http_requests_total[1m]))
  ```

* 95th percentile request latency:

  ```
  histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket[5m])) by (le))
  ```

* Node CPU usage (non-idle):

  ```
  1 - avg by (instance) (rate(node_cpu_seconds_total{mode="idle"}[5m]))
  ```

* Memory usage fraction:

  ```
  1 - (node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes)
  ```

Use these queries in Grafana panels and configure thresholds to create alerts.

---

## Alert rules (example) and Alertmanager flow

1. Alerts defined in `prometheus/alerts.yml` are read by Prometheus (`rule_files`).
2. When a rule fires, Prometheus sends the alert to Alertmanager (configured in `prometheus.yml`).
3. Alertmanager groups and forwards notifications using its `alertmanager.yml` configuration.

**To test alerts**:

* Temporarily tweak alert `expr` to a condition that is currently true (e.g., `up == 1`) and watch Alertmanager/Grafana.
* Use `curl` to POST synthetic alerts to Alertmanager `/api/v2/alerts` (for testing) if needed.

---

## Loki permissions and common errors

**Symptoms**:

* Loki container repeatedly restarts with logs like:

  ```
  creating WAL folder at "/wal": mkdir wal: permission denied
  mkdir : no such file or directory
  error initialising module: compactor
  ```

**Root causes**:

* Host volume mapped to `./loki-data` lacks required subdirectories or correct ownership/permissions.
* Loki attempts to create directories under `/loki` and must have write permission.

**Fixes** (choose one):

1. **Create directories on host and set permissive permissions**:

   ```bash
   mkdir -p ./loki-data/{chunks,index,wal,boltdb-cache}
   sudo chown -R 10001:10001 ./loki-data || sudo chown -R root:root ./loki-data
   sudo chmod -R 0770 ./loki-data
   ```

   (If chown to 10001 fails, try `chown -R root:root` and use container `user: "0"` in compose as quick fix.)

2. **Run Loki container as root in dev/test** (not recommended for production):

   ```yaml
   loki:
     user: "0:0"
   ```

   Using `user: "0:0"` lets Loki create necessary dirs. Better long-term: assign the proper UID/GID to the host dirs.

3. **Ensure `loki/local-config.yaml` uses the same paths** (e.g., `/loki/wal`, `/loki/index` etc.) — the directories should exist and be writable.

**Best practice**: Create the host folder and `chown` to the UID that Loki runs as inside container (check logs or image docs) — in many official images that UID is `10001` or similar.

---

## Common troubleshooting & solutions

### CORS: `CORS request did not succeed` or `Access-Control-Allow-Origin missing`

* Backend must `app.use(cors())` or `app.use(cors({ origin: <your_frontend_origin> }))`.
* If the browser reports `Status code: (null)` or `did not succeed`, check network connectivity (are ports open? is backend reachable from browser?). Use `curl` from host: `curl http://192.168.44.132:4000/api/health` — you saw `{"status":"ok"}` earlier, good.
* Vite development server vs production build: if frontend served at `http://192.168.44.132:3000`, add that to allowed origins.

### `Cannot read properties of undefined (reading 'title')` on POST

* Solution: Ensure `body-parser` or `express.json()` is used:

  ```js
  app.use(bodyParser.json()); // or app.use(express.json())
  ```

### Docker build COPY errors: `scripts/load_test.sh: not found`

* Cause: wrong build `context`. `COPY` paths are relative to the build context.
* Fix: in `docker-compose.yml`, set `backend.build.context: .` and `dockerfile: backend/Dockerfile`, or move `load_test.sh` under `backend/` and adjust COPY.

### Prometheus cannot scrape node\_exporter (target down)

* If Prometheus uses `node_exporter:9100` but your `node_exporter` is run with host network or on host IP, adjust `prometheus.yml` accordingly.
* Use `docker compose exec prometheus curl -s http://node_exporter:9100/metrics` to test from within Prometheus container network.

### Grafana alerts: `SMTP not configured`

* Grafana's own SMTP settings are separate from Alertmanager. Add `GF_SMTP_*` variables in Grafana container env or set up contact points in Grafana that point to Alertmanager (Grafana → Alerting → Contact points).
* For Alertmanager email sending, ensure `alertmanager.yml` has `smtp_auth` set and credentials correctly provided via `.env`.

### Alertmanager Gmail `535 5.7.8 Username and Password not accepted`

* Use a Gmail App Password (create via Google Account Security -> App Passwords). Use that string as `SMTP_PASS`.
* Ensure the `smtp_from`/`smtp_auth_username` match the account used for App Password.

---

## How to inspect DB & logs, check endpoints, verify metrics

* **Check Mongo**:

  ```bash
  docker compose exec mongo mongosh
  # in mongosh:
  use todoapp
  db.todos.find().pretty()
  ```

* **Check backend endpoint**:

  ```bash
  curl http://192.168.44.132:4000/api/health
  curl http://192.168.44.132:4000/api/todos
  curl http://192.168.44.132:4000/metrics
  ```

* **Check Prometheus targets**:

  * Open `http://192.168.44.132:9090/targets` in your browser. It shows each scrape target and last scrape result.

* **Check Loki**:

  * If Loki is running, open `http://192.168.44.132:3100/ready` or `http://192.168.44.132:3100/` (API). If you see permission errors, fix Loki volume permissions.

* **Check Promtail logs**:

  ```bash
  docker compose logs -f promtail
  ```

* **View Grafana**:

  * Login at `http://192.168.44.132:4001` (username `admin`, password `admin` if you used that env). Check Data Sources (Prometheus, Loki), Dashboards, and Alerting > Contact points.

---

## Appendix — useful commands & examples

* Rebuild just frontend with new `VITE_API_URL`:

  ```bash
  docker compose build --no-cache frontend
  docker compose up -d frontend
  ```

* Recreate Loki with corrected permissions:

  ```bash
  docker compose down loki
  mkdir -p loki-data/{chunks,index,wal,boltdb-cache}
  sudo chown -R 10001:10001 loki-data || sudo chown -R root:root loki-data
  docker compose up -d loki
  docker compose logs -f loki
  ```

* Test email from Alertmanager (simulate alert):

  ```bash
  curl -XPOST -d '[{"labels":{"alertname":"TestAlert","severity":"critical"}}]' http://localhost:9093/api/v2/alerts
  ```

* Test that Prometheus can query its targets:

  ```bash
  curl 'http://localhost:9090/api/v1/query?query=up'
  ```

* Stop & cleanup:

  ```bash
  docker compose down -v
  ```

---

## Final checklist — things to verify if something fails

1. `docker compose ps` — see all containers healthy.
2. `docker compose logs <service>` — look for startup errors.
3. `curl` the backend `/api/health`, `/api/todos`, `/metrics`.
4. Prometheus → `/targets` — ensure targets are UP.
5. Grafana → Data sources — verify Prometheus and Loki test OK.
6. Loki container logs — fix WAL permission if needed.
7. Use `mongosh` to inspect test data. Verify load test created todos.
8. Rebuild frontend after editing `VITE_API_URL` (Vite is build-time).

---

## Outputs
- **Promethus enpoints**
![](/snap/prometheus-endpoints.png)
- **frontend-app**
![](/snap/frontend-0.png)
![](/snap/frontend-1.png)
- **grafana-metrics**
![](/snap/g-metrics-create.png)
- **grafana-alert-firing**
![](/snap/alert-firing.png)
- **email-firing-notification**
![](/snap/email-firing.png)
![](/snap/email-resolve.png)
- **mongo-DB**
![](/snap/mongodb-dbs.png)

## Summary

This README walked through the full stack setup, provided explicit configuration examples and remedies for common issues you faced:

* **CORS**: add proper origins and ensure backend parses JSON.
* **.env / Vite**: Vite picks env vars at build time — rebuild when changed.
* **Docker build COPY errors**: set correct build context (root) so `scripts/` is available.
* **Loki WAL/permission**: create directories and set permissions or run Loki as root (dev only).
* **Prometheus scrape config**: prefer container service names inside `docker-compose` network.
* **Alertmanager & SMTP**: use Gmail App Password, and set env vars properly.
* **Load testing**: `scripts/load_test.sh` runs multiple curl loops; backend exposes endpoints for start/stop & logs.

---
