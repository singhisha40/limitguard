const mongoose = require('mongoose');
const config = require('./config');
const { createRedis, waitUntilReady } = require('./redis');
const { createLimiter } = require('./limiters');
const { RuleStore, DEFAULT_RULES } = require('./services/ruleStore');
const { createStats } = require('./services/stats');
const { createApp } = require('./app');
const Rule = require('./models/Rule');
const BlockEvent = require('./models/BlockEvent');

async function main() {
  mongoose.set('bufferCommands', false); // fail fast instead of queueing when Mongo is down

  const redis = createRedis();
  if (!(await waitUntilReady(redis))) {
    console.warn(`Redis not reachable at ${config.redisUrl}; starting in degraded mode (fail ${config.failMode})`);
  }
  const limiter = createLimiter(redis);
  const stats = createStats(redis);

  const ruleStore = new RuleStore({
    ttlMs: config.ruleCacheTtlMs,
    loader: async () => {
      if (mongoose.connection.readyState !== 1) throw new Error('mongo down');
      return Rule.find().lean();
    },
  });

  // MongoDB is optional at startup: the limiter keeps working on built-in rules without it.
  mongoose.connect(config.mongoUrl, { serverSelectionTimeoutMS: 4000 }).then(
    async () => {
      console.log('MongoDB connected');
      if ((await Rule.countDocuments()) === 0) {
        await Rule.insertMany(DEFAULT_RULES);
        console.log('Seeded default rules');
      }
      ruleStore.invalidate();
    },
    (err) => console.warn(`MongoDB unavailable (${err.message}); using built-in rules, rule editing disabled`)
  );

  const onBlock = (event) => {
    if (mongoose.connection.readyState !== 1) return;
    BlockEvent.create(event).catch(() => {});
  };

  const getEvents = async (limit) => {
    if (mongoose.connection.readyState !== 1) return [];
    return BlockEvent.find().sort({ at: -1 }).limit(limit).lean();
  };

  const app = createApp({
    redis,
    limiter,
    ruleStore,
    stats,
    onBlock,
    getEvents,
    failMode: config.failMode,
    clientOrigin: config.clientOrigin,
    trustProxy: process.env.TRUST_PROXY || false,
  });

  const server = app.listen(config.port, () => {
    console.log(`LimitGuard listening on :${config.port} (fail mode: ${config.failMode})`);
  });

  const shutdown = async () => {
    server.close();
    await Promise.allSettled([redis.quit(), mongoose.disconnect()]);
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main();
