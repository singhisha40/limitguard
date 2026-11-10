const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const { createRateLimit } = require('./middleware/rateLimit');
const rulesRouter = require('./routes/rules');
const demoRouter = require('./routes/demo');

/**
 * Builds the Express app from injected dependencies so tests can pass
 * a test Redis and fake rule loaders without touching MongoDB.
 */
function createApp({ redis, limiter, ruleStore, stats, onBlock, getEvents, failMode, clientOrigin, trustProxy }) {
  const app = express();
  if (trustProxy) app.set('trust proxy', trustProxy);
  app.use(cors({ origin: clientOrigin || true, exposedHeaders: ['RateLimit-Limit', 'RateLimit-Remaining', 'Retry-After', 'X-RateLimit-Rule', 'X-RateLimit-Status'] }));
  app.use(express.json({ limit: '10kb' }));

  const rateLimit = createRateLimit({ limiter, ruleStore, stats, onBlock, failMode });

  app.get('/health', async (req, res) => {
    let redisOk = false;
    try {
      redisOk = (await redis.ping()) === 'PONG';
    } catch {
      /* leave false */
    }
    res.status(redisOk ? 200 : 503).json({
      status: redisOk ? 'ok' : 'degraded',
      redis: redisOk,
      mongo: mongoose.connection.readyState === 1,
    });
  });

  // ---- Rate limiter as a service: any backend can ask "may this identifier proceed?" ----
  app.post('/v1/check', async (req, res) => {
    const { rule: ruleName, identifier } = req.body || {};
    if (typeof ruleName !== 'string' || typeof identifier !== 'string' || !identifier || identifier.length > 200) {
      return res.status(400).json({ error: 'Body must be { rule: string, identifier: string }' });
    }
    const rule = await ruleStore.get(ruleName);
    if (!rule) return res.status(404).json({ error: `Unknown rule "${ruleName}"` });

    try {
      const result = await limiter.check(rule, identifier);
      stats.record(rule.name, result.allowed);
      if (!result.allowed && onBlock) {
        onBlock({ rule: rule.name, identifier, path: '/v1/check', retryAfterMs: result.retryAfterMs });
      }
      res.json({ ...result, rule: rule.name });
    } catch {
      res.status(503).json({ error: 'Rate limiter unavailable' });
    }
  });

  // Baseline for load tests: no limiter, no Redis. Compare against /api/protected/ping.
  app.get('/api/open/ping', (req, res) => res.json({ ok: true }));

  // ---- Demo endpoints protected by the middleware, used by the dashboard playground ----
  app.get('/api/protected/ping', rateLimit('default'), (req, res) => res.json({ ok: true, at: Date.now() }));
  app.get('/api/protected/search', rateLimit('strict'), (req, res) => res.json({ ok: true, results: [] }));
  app.post('/api/protected/login', rateLimit('login'), (req, res) => res.json({ ok: true }));

  // ---- Dashboard data ----
  app.get('/api/stats', async (req, res) => {
    const buckets = Math.min(180, Math.max(6, Number(req.query.buckets) || 30));
    try {
      res.json({ bucketMs: stats.BUCKET_MS, series: await stats.series(buckets) });
    } catch {
      res.status(503).json({ error: 'Redis unavailable' });
    }
  });

  app.get('/api/events', async (req, res) => {
    res.json(getEvents ? await getEvents(Math.min(100, Number(req.query.limit) || 20)) : []);
  });

  app.use('/api/rules', rulesRouter({ ruleStore }));
  app.use('/api/demo', demoRouter({ redis, limiter }));

  app.use((req, res) => res.status(404).json({ error: 'Not found' }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON' });
    res.status(500).json({ error: 'Internal error' });
  });

  return app;
}

module.exports = { createApp };
