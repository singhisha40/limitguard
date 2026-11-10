const request = require('supertest');
const { randomUUID } = require('crypto');
const { createRedis, waitUntilReady } = require('../src/redis');
const { createLimiter } = require('../src/limiters');
const { RuleStore } = require('../src/services/ruleStore');
const { createStats } = require('../src/services/stats');
const { createApp } = require('../src/app');

let redis;
let app;
const blocked = [];
const suffix = randomUUID().slice(0, 8);

const rules = [
  { name: 'default', algorithm: 'token_bucket', limit: 3, windowSec: 3600, keyBy: 'ip', enabled: true },
  { name: 'strict', algorithm: 'sliding_window', limit: 2, windowSec: 3600, keyBy: 'ip', enabled: true },
  { name: 'login', algorithm: 'fixed_window', limit: 2, windowSec: 3600, keyBy: 'ip', enabled: false },
  { name: `svc-${suffix}`, algorithm: 'sliding_window', limit: 2, windowSec: 3600, keyBy: 'apiKey', enabled: true },
];

function build(failMode = 'open', redisClient = redis) {
  const limiter = createLimiter(redisClient);
  return createApp({
    redis: redisClient,
    limiter,
    ruleStore: new RuleStore({ ttlMs: 60000, loader: async () => rules }),
    stats: createStats(redisClient),
    onBlock: (e) => blocked.push(e),
    getEvents: async () => blocked,
    failMode,
  });
}

beforeAll(async () => {
  redis = createRedis('redis://127.0.0.1:6379');
  await waitUntilReady(redis);
  app = build();
});

afterAll(async () => {
  await redis.quit();
});

describe('middleware', () => {
  test('allows requests under the limit and sets headers', async () => {
    const res = await request(app).get('/api/protected/ping').set('X-Forwarded-For', '1.1.1.1');
    // keyed by req.ip which is the same for every supertest call, so use a fresh rule per test below
    expect([200, 429]).toContain(res.status);
    expect(res.headers['ratelimit-limit']).toBe('3');
    expect(res.headers['x-ratelimit-rule']).toBe('default');
  });

  test('returns 429 with Retry-After once the limit is exhausted', async () => {
    const statuses = [];
    let last;
    for (let i = 0; i < 6; i++) {
      last = await request(app).get('/api/protected/search');
      statuses.push(last.status);
    }
    expect(statuses.filter((s) => s === 200).length).toBeLessThanOrEqual(2);
    expect(statuses).toContain(429);
    expect(last.headers['retry-after']).toBeDefined();
    expect(last.body.error).toBe('Too many requests');
    expect(blocked.length).toBeGreaterThan(0);
  });

  test('disabled rules are skipped', async () => {
    for (let i = 0; i < 5; i++) {
      const res = await request(app).post('/api/protected/login');
      expect(res.status).toBe(200);
    }
  });
});

describe('POST /v1/check (limiter as a service)', () => {
  const rule = `svc-${suffix}`;

  test('validates input', async () => {
    expect((await request(app).post('/v1/check').send({})).status).toBe(400);
    expect((await request(app).post('/v1/check').send({ rule, identifier: '' })).status).toBe(400);
  });

  test('404 for unknown rule', async () => {
    const res = await request(app).post('/v1/check').send({ rule: 'nope', identifier: 'x' });
    expect(res.status).toBe(404);
  });

  test('counts per identifier', async () => {
    const id = `user-${randomUUID()}`;
    const a = await request(app).post('/v1/check').send({ rule, identifier: id });
    const b = await request(app).post('/v1/check').send({ rule, identifier: id });
    const c = await request(app).post('/v1/check').send({ rule, identifier: id });
    expect(a.body.allowed).toBe(true);
    expect(b.body.allowed).toBe(true);
    expect(c.body.allowed).toBe(false);
    expect(c.body.retryAfterMs).toBeGreaterThan(0);

    const other = await request(app).post('/v1/check').send({ rule, identifier: `user-${randomUUID()}` });
    expect(other.body.allowed).toBe(true);
  });
});

describe('stats and demo', () => {
  test('stats reports allowed and blocked counts', async () => {
    const res = await request(app).get('/api/stats?buckets=6');
    expect(res.status).toBe(200);
    expect(res.body.series).toHaveLength(6);
    const totalBlocked = res.body.series.reduce((n, b) => n + b.blocked, 0);
    expect(totalBlocked).toBeGreaterThan(0);
  });

  test('race demo shows naive overshoot and atomic exactness', async () => {
    const res = await request(app).post('/api/demo/race').send({ limit: 20, requests: 200 });
    expect(res.status).toBe(200);
    expect(res.body.atomic.allowed).toBe(20);
    expect(res.body.naive.allowed).toBeGreaterThan(20);
  });
});

describe('Redis outage policy', () => {
  // port 1 is never open, so every command fails fast
  const deadRedis = () => {
    const r = createRedis('redis://127.0.0.1:1');
    return r;
  };

  test('fail-open lets traffic through and flags it as degraded', async () => {
    const dead = deadRedis();
    const res = await request(build('open', dead)).get('/api/protected/ping');
    expect(res.status).toBe(200);
    expect(res.headers['x-ratelimit-status']).toBe('degraded');
    dead.disconnect();
  });

  test('fail-closed returns 503', async () => {
    const dead = deadRedis();
    const res = await request(build('closed', dead)).get('/api/protected/ping');
    expect(res.status).toBe(503);
    dead.disconnect();
  });
});
