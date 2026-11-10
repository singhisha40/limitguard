require('dotenv').config();

module.exports = {
  port: Number(process.env.PORT || 4000),
  redisUrl: process.env.REDIS_URL || 'redis://127.0.0.1:6379',
  mongoUrl: process.env.MONGO_URL || 'mongodb://127.0.0.1:27017/limitguard',
  clientOrigin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',
  // "open": allow traffic if Redis is down (availability first)
  // "closed": reject traffic if Redis is down (protection first)
  failMode: process.env.FAIL_MODE === 'closed' ? 'closed' : 'open',
  ruleCacheTtlMs: Number(process.env.RULE_CACHE_TTL_MS || 5000),
};
