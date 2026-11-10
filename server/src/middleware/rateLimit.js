/**
 * Express middleware factory.
 *
 *   const rateLimit = createRateLimit({ limiter, ruleStore, stats, onBlock, failMode });
 *   app.get('/api/thing', rateLimit('default'), handler);
 *
 * Behaviour:
 *  - Looks up the named rule (cached in memory) and builds an identifier (IP or API key).
 *  - Runs the atomic Lua check in Redis.
 *  - Sets standard headers and returns 429 + Retry-After when blocked.
 *  - If Redis is down, applies failMode: "open" lets the request through, "closed" returns 503.
 */
function createRateLimit({ limiter, ruleStore, stats, onBlock, failMode = 'open' }) {
  return function rateLimit(ruleName) {
    return async function rateLimitMiddleware(req, res, next) {
      let rule;
      try {
        rule = await ruleStore.get(ruleName);
      } catch {
        rule = null;
      }
      if (!rule) {
        res.set('X-RateLimit-Status', 'no-rule');
        return next();
      }
      if (!rule.enabled) return next();

      const identifier = identify(req, rule);

      let result;
      try {
        result = await limiter.check(rule, identifier);
      } catch (err) {
        // Redis unreachable / timed out
        res.set('X-RateLimit-Status', 'degraded');
        if (failMode === 'closed') {
          return res.status(503).json({ error: 'Rate limiter unavailable, try again shortly' });
        }
        return next();
      }

      res.set({
        'RateLimit-Limit': String(result.limit),
        'RateLimit-Remaining': String(result.remaining),
        'X-RateLimit-Rule': rule.name,
      });

      stats.record(rule.name, result.allowed); // fire and forget

      if (!result.allowed) {
        const retryAfterSec = Math.max(1, Math.ceil(result.retryAfterMs / 1000));
        res.set('Retry-After', String(retryAfterSec));
        if (onBlock) {
          onBlock({
            rule: rule.name,
            identifier,
            path: req.originalUrl,
            retryAfterMs: result.retryAfterMs,
          });
        }
        return res.status(429).json({
          error: 'Too many requests',
          rule: rule.name,
          retryAfterMs: result.retryAfterMs,
        });
      }

      return next();
    };
  };
}

function identify(req, rule) {
  if (rule.keyBy === 'apiKey') {
    const key = req.get('x-api-key');
    if (key) return `key:${key}`;
  }
  return `ip:${req.ip}`;
}

module.exports = { createRateLimit, identify };
