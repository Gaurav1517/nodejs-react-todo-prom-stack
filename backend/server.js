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

// Prometheus metrics endpoint
app.get('/metrics', async (req, res) => {
  res.setHeader('Content-Type', register.contentType);
  res.end(await register.metrics());
});

app.listen(port, () => logger.info(`Backend running on port ${port}`));



// const express = require('express');
// const mongoose = require('mongoose');
// const bodyParser = require('body-parser');
// const promClient = require('prom-client');
// const morgan = require('morgan');
// const cors = require('cors');
// const fs = require('fs-extra');
// const path = require('path');

// const app = express();
// const port = process.env.PORT || 4000;
// const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017/todoapp';

// // Ensure log dir
// fs.ensureDirSync('/var/log');

// // create a write stream for file logging
// const accessLogStream = fs.createWriteStream('/var/log/backend.log', { flags: 'a' });

// app.use(bodyParser.json());
// app.use(morgan('combined', { stream: accessLogStream }));
// app.use(morgan('combined')); // also to stdout

// // ✅ Explicit CORS setup
// const allowedOrigins = [
//   'http://localhost:3000',        // local dev
//   'http://frontend:3000',         // container name
//   'http://192.168.44.132:3000'    // your host IP frontend
// ];

// app.use(cors({
//   origin: function (origin, callback) {
//     // Allow requests with no origin (like curl, Postman)
//     if (!origin || allowedOrigins.includes(origin)) {
//       callback(null, true);
//     } else {
//       console.warn("Blocked CORS for origin:", origin);
//       callback(new Error('CORS not allowed for this origin: ' + origin));
//     }
//   },
//   methods: ['GET', 'POST', 'PUT', 'DELETE'],
//   allowedHeaders: ['Content-Type'],
//   credentials: true
// }));

// // Prometheus
// const register = promClient.register;
// promClient.collectDefaultMetrics({ register });
// const httpRequestDurationMicroseconds = new promClient.Histogram({
//   name: 'http_request_duration_seconds',
//   help: 'Duration of HTTP requests in seconds',
//   labelNames: ['method', 'route', 'code'],
//   buckets: [0.005,0.01,0.05,0.1,0.5,1,2,5]
// });
// const todoCount = new promClient.Gauge({
//   name: 'todo_count',
//   help: 'Number of todos in DB'
// });

// // Mongoose
// const todoSchema = new mongoose.Schema({
//   title: String,
//   done: { type: Boolean, default: false },
//   createdAt: { type: Date, default: Date.now }
// });
// const Todo = mongoose.model('Todo', todoSchema);

// mongoose.connect(mongoUri, { useNewUrlParser: true, useUnifiedTopology: true })
//   .then(() => console.log('MongoDB connected'))
//   .catch(err => console.error(err));

// app.get('/api/health', (req,res)=>res.json({status:'ok'}));

// app.get('/api/todos', async (req,res)=>{
//   const end = httpRequestDurationMicroseconds.startTimer();
//   try{
//     const todos = await Todo.find().sort({createdAt:-1});
//     todoCount.set(todos.length);
//     res.json(todos);
//     end({method:req.method,route:req.route.path,code:200});
//   }catch(e){
//     res.status(500).json({error:e.message});
//     end({method:req.method,route:(req.route?req.route.path:req.path),code:500});
//   }
// });

// app.post('/api/todos', async (req,res)=>{
//   const end = httpRequestDurationMicroseconds.startTimer();
//   try{
//     const t = new Todo({title:req.body.title});
//     await t.save();
//     const count = await Todo.countDocuments();
//     todoCount.set(count);
//     res.status(201).json(t);
//     end({method:req.method,route:req.route.path,code:201});
//   }catch(e){
//     res.status(500).json({error:e.message});
//     end({method:req.method,route:(req.route?req.route.path:req.path),code:500});
//   }
// });

// app.put('/api/todos/:id', async (req,res)=>{
//   const end = httpRequestDurationMicroseconds.startTimer();
//   try{
//     const t = await Todo.findByIdAndUpdate(req.params.id, req.body, {new:true});
//     const count = await Todo.countDocuments();
//     todoCount.set(count);
//     if(!t) return res.status(404).end();
//     res.json(t);
//     end({method:req.method,route:req.route.path,code:200});
//   }catch(e){
//     res.status(500).json({error:e.message});
//     end({method:req.method,route:(req.route?req.route.path:req.path),code:500});
//   }
// });

// app.delete('/api/todos/:id', async (req,res)=>{
//   const end = httpRequestDurationMicroseconds.startTimer();
//   try{
//     await Todo.findByIdAndDelete(req.params.id);
//     const count = await Todo.countDocuments();
//     todoCount.set(count);
//     res.status(204).end();
//     end({method:req.method,route:req.route.path,code:204});
//   }catch(e){
//     res.status(500).json({error:e.message});
//     end({method:req.method,route:(req.route?req.route.path:req.path),code:500});
//   }
// });

// app.get('/metrics', async (req,res)=>{
//   res.setHeader('Content-Type', register.contentType);
//   res.end(await register.metrics());
// });

// app.listen(port, ()=>console.log(`Backend on ${port}`));
