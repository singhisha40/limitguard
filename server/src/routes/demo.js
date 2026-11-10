const express = require('express');
const { randomUUID } = require('crypto');
const { naiveCheck } = require('../limiters/naive');

/**
 * POST /api/demo/race  { limit: 50, requests: 200 }
 *
 * Fires `requests` concurrent checks at a limit of `limit`, once with the naive
 * read-then-write limiter and once with the atomic Lua limiter, and reports how many
 * were allowed. A correct limiter allows exactly `limit`.
 */
module.exports = function demoRouter({ redis, limiter }) {
  const router = express.Router();

  router.post('/race', async (req, res) => {
    const limit = clamp(Number(req.body.limit) || 50, 1, 1000);
    const requests = clamp(Number(req.body.requests) || 200, limit, 3000);
    const runId = randomUUID();

    try {
      const naiveStart = process.hrtime.bigint();
      const naiveResults = await Promise.all(
        Array.from({ length: requests }, () => naiveCheck(redis, `demo:naive:${runId}`, limit, 60))
      );
      const naiveMs = Number(process.hrtime.bigint() - naiveStart) / 1e6;

      const rule = { name: `demo-${runId}`, algorithm: 'sliding_window', limit, windowSec: 60 };
      const atomicStart = process.hrtime.bigint();
      const atomicResults = await Promise.all(
        Array.from({ length: requests }, () => limiter.check(rule, 'race'))
      );
      const atomicMs = Number(process.hrtime.bigint() - atomicStart) / 1e6;

      res.json({
        limit,
        requests,
        naive: {
          allowed: naiveResults.filter((r) => r.allowed).length,
          overshoot: naiveResults.filter((r) => r.allowed).length - limit,
          ms: Math.round(naiveMs),
        },
        atomic: {
          allowed: atomicResults.filter((r) => r.allowed).length,
          overshoot: atomicResults.filter((r) => r.allowed).length - limit,
          ms: Math.round(atomicMs),
        },
      });
    } catch (err) {
      res.status(503).json({ error: 'Redis unavailable' });
    }
  });

  return router;
};

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
