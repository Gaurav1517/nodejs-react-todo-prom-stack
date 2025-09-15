// backend/models/LoadResult.js
const mongoose = require('mongoose');

const LoadResultSchema = new mongoose.Schema({
  startTime: { type: Date, default: Date.now },
  duration: { type: Number, default: 0 },   // seconds
  clients: { type: Number, default: 0 },
  url: { type: String },
  status: { type: String, enum: ['running','completed','failed','stopped'], default: 'running' },
  pid: { type: Number, default: null },
  logFile: { type: String, default: null },
  output: { type: String, default: '' }
});

module.exports = mongoose.model('LoadResult', LoadResultSchema);
