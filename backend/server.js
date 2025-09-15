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
const { exec } = require("child_process");
// add near top of backend/server.js with other requires
const { spawn } = require('child_process');
const LoadResult = require('./models/LoadResult'); // new model
// reuse existing fs (you have fs = require('fs-extra'))
const runningTests = new Map(); // testId -> child process


// ====== Setup Logger with Loki ======
const logger = winston.createLogger({
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.printf(
      (info) => `[${info.timestamp}] ${info.level.toUpperCase()}: ${info.message}`
    )
  ),
  transports: [
    new LokiTransport({
      host: 'http://loki:3100', // Loki service in docker-compose
      labels: { app: 'todo-app', service: 'backend' },
      json: true,
      replaceTimestamp: true,
    }),
    new winston.transports.Console(),
    new winston.transports.File({ filename: '/var/log/backend.log' }),
  ],
});

const app = express();
const port = process.env.PORT || 4000;
const mongoUri = process.env.MONGO_URI || 'mongodb://mongo:27017/todoapp';

// ====== Ensure log dir exists ======
fs.ensureDirSync('/var/log');

// create a write stream for HTTP access logging
const accessLogStream = fs.createWriteStream('/var/log/access.log', { flags: 'a' });

// ====== Middleware ======
app.use(bodyParser.json()); // ✅ FIX: parse JSON body
app.use(bodyParser.urlencoded({ extended: true })); // parse URL-encoded
app.use(morgan('combined', { stream: accessLogStream }));
app.use(
  morgan('combined', {
    stream: { write: (msg) => logger.info(msg.trim()) },
  })
);

// ====== CORS ======
const allowedOrigins = [
  'http://localhost:3000',
  'http://frontend:3000',
  'http://192.168.44.132:3000',
];

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        logger.warn(`Blocked CORS for origin: ${origin}`);
        callback(new Error('CORS not allowed for this origin: ' + origin));
      }
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type'],
    credentials: true,
  })
);

// ====== Prometheus Metrics ======
const register = promClient.register;
promClient.collectDefaultMetrics({ register });

const httpRequestDurationSeconds = new promClient.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'code'],
  buckets: [0.005, 0.01, 0.05, 0.1, 0.5, 1, 2, 5],
});

const httpRequestsTotal = new promClient.Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status'],
});

const todosCreated = new promClient.Counter({
  name: 'todos_created_total',
  help: 'Total number of todos created',
});
const todosDeleted = new promClient.Counter({
  name: 'todos_deleted_total',
  help: 'Total number of todos deleted',
});
const todosCompleted = new promClient.Counter({
  name: 'todos_completed_total',
  help: 'Total number of todos marked complete',
});

const todoCount = new promClient.Gauge({
  name: 'todo_count',
  help: 'Number of todos in DB',
});

// Middleware for metrics
app.use((req, res, next) => {
  const end = httpRequestDurationSeconds.startTimer();
  res.on('finish', () => {
    const route = req.route && req.route.path ? req.route.path : req.path;
    httpRequestsTotal.inc({
      method: req.method,
      route,
      status: res.statusCode,
    });
    end({ method: req.method, route, code: res.statusCode });
    logger.info(`${req.method} ${req.originalUrl} -> ${res.statusCode}`);
  });
  next();
});

// ====== Mongoose ======
const todoSchema = new mongoose.Schema({
  title: String,
  done: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
});
const Todo = mongoose.model('Todo', todoSchema);

mongoose
  .connect(mongoUri, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => logger.info('MongoDB connected'))
  .catch((err) => logger.error(`MongoDB connection error: ${err}`));

// ====== Routes ======
app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

app.get('/api/todos', async (req, res) => {
  try {
    const todos = await Todo.find().sort({ createdAt: -1 });
    todoCount.set(todos.length);
    res.json(todos);
  } catch (e) {
    logger.error(`GET /api/todos failed: ${e.message}`);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/todos', async (req, res) => {
  try {
    if (!req.body || !req.body.title) {
      return res.status(400).json({ error: 'Title is required' });
    }
    const t = new Todo({ title: req.body.title });
    await t.save();
    const count = await Todo.countDocuments();
    todoCount.set(count);
    todosCreated.inc();
    logger.info(`Created todo: ${t.title}`);
    res.status(201).json(t);
  } catch (e) {
    logger.error(`POST /api/todos failed: ${e.message}`);
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/todos/:id', async (req, res) => {
  try {
    const t = await Todo.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
    });
    const count = await Todo.countDocuments();
    todoCount.set(count);
    if (req.body.done === true) todosCompleted.inc();
    if (!t) return res.status(404).end();
    logger.info(`Updated todo: ${t._id}`);
    res.json(t);
  } catch (e) {
    logger.error(`PUT /api/todos/${req.params.id} failed: ${e.message}`);
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/todos/:id', async (req, res) => {
  try {
    await Todo.findByIdAndDelete(req.params.id);
    const count = await Todo.countDocuments();
    todoCount.set(count);
    todosDeleted.inc();
    logger.info(`Deleted todo: ${req.params.id}`);
    res.status(204).end();
  } catch (e) {
    logger.error(`DELETE /api/todos/${req.params.id} failed: ${e.message}`);
    res.status(500).json({ error: e.message });
  }
});

//  Add these new routes below your existing routes
// Start a new load test
app.post('/api/load-test', async (req, res) => {
  try {
    const duration = Number(req.body.duration) || 60;
    const clients = Number(req.body.clients) || 10;
    const url = req.body.url || process.env.LOAD_TEST_URL || 'http://localhost:4000/api/todos';

    // create a DB entry
    const test = new LoadResult({
      duration,
      clients,
      url,
      status: 'running'
    });
    await test.save();

    // prepare logfile path
    const logFile = `/var/log/load_test_${test._id}.log`;
    test.logFile = logFile;
    await test.save();

    // spawn the script: ensure script path matches what you copied into the image
    // The script path we will copy into Docker image: /app/load_test.sh
    const child = spawn('bash', ['/app/load_test.sh', String(duration), String(clients), url], {
      detached: false,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    // write stdout+stderr to file
    const outStream = fs.createWriteStream(logFile, { flags: 'a' });
    child.stdout.pipe(outStream);
    child.stderr.pipe(outStream);

    // store pid & child in memory, update DB
    runningTests.set(String(test._id), child);
    test.pid = child.pid;
    await test.save();

    // when process exits update DB
    child.on('exit', async (code, signal) => {
      try {
        const doc = await LoadResult.findById(test._id);
        doc.status = code === 0 ? 'completed' : 'failed';
        doc.output = fs.readFileSync(logFile, 'utf8').slice(0, 100000); // store up to 100k chars
        doc.pid = null;
        await doc.save();
      } catch (err) {
        logger.error('Error updating load test result: ' + err.message);
      } finally {
        runningTests.delete(String(test._id));
      }
    });

    res.json({ message: 'Load test started', testId: test._id });
  } catch (err) {
    logger.error('Error starting load test: ' + err.message);
    res.status(500).json({ error: err.message });
  }
});

// Stop a running load test (by testId)
app.post('/api/load-test/stop', async (req, res) => {
  try {
    const { testId } = req.body;
    if (!testId) return res.status(400).json({ error: 'testId required' });
    const child = runningTests.get(String(testId));
    if (!child) {
      // If process not found in memory, update DB if necessary
      await LoadResult.findByIdAndUpdate(testId, { status: 'stopped', pid: null });
      return res.json({ message: 'No running process found for this testId (maybe already finished)' });
    }
    // politely ask to stop, then force kill after timeout
    child.kill('SIGINT');
    setTimeout(() => {
      try {
        process.kill(child.pid, 'SIGKILL');
      } catch (e) {}
    }, 5000);

    await LoadResult.findByIdAndUpdate(testId, { status: 'stopped', pid: null });
    runningTests.delete(String(testId));
    res.json({ message: 'Stop signal sent' });
  } catch (err) {
    logger.error('Error stopping load test: ' + err.message);
    res.status(500).json({ error: err.message });
  }
});

// List past load tests (most recent first)
app.get('/api/load-tests', async (req, res) => {
  try {
    const results = await LoadResult.find().sort({ startTime: -1 }).limit(50);
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get a load test log file content (plain text)
app.get('/api/load-test/:id/log', async (req, res) => {
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


// Prometheus metrics endpoint
app.get('/metrics', async (req, res) => {
  res.setHeader('Content-Type', register.contentType);
  res.end(await register.metrics());
});



app.listen(port, () => logger.info(`Backend running on port ${port}`));
