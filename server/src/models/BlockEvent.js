const mongoose = require('mongoose');

// Sampled log of rejected requests, auto-deleted after 24h by a TTL index.
// Per-request counters live in Redis instead; Mongo is only for things worth reading later.
const BlockEventSchema = new mongoose.Schema({
  rule: { type: String, index: true },
  identifier: String,
  path: String,
  retryAfterMs: Number,
  at: { type: Date, default: Date.now, expires: 60 * 60 * 24 },
});

module.exports = mongoose.models.BlockEvent || mongoose.model('BlockEvent', BlockEventSchema);
