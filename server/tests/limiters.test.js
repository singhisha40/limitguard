const { createRedis, waitUntilReady } = require('../src/redis');
const { createLimiter } = require('../src/limiters');
const { naiveCheck } = require('../src/limiters/naive');
const { randomUUID } = require('crypto');

let redis;
let limiter;

beforeAll(async () => {
  redis = createRedis('redis://127.0.0.1:6379');
  await waitUntilReady(redis);
  limiter = createLimiter(redis);
});

afterAll(async () => {
  await redis.quit();
});

const uniqueRule = (overrides) => ({
  name: `test-${randomUUID()}`,
  algorithm: 'token_bucket',
  limit: 5,
  windowSec: 10,
  ...overrides,
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

describe('token bucket', () => {
  test('allows a burst up to capacity, then blocks', async () => {
    const rule = uniqueRule({ limit: 5, windowSec: 3600 }); // refill is negligible
    const results = [];
    for (let i = 0; i < 8; i++) results.push(await limiter.check(rule, 'u1'));

    expect(results.filter((r) => r.allowed)).toHaveLength(5);
    expect(results[4].remaining).toBe(0);
    expect(results[5].allowed).toBe(false);
    expect(results[5].retryAfterMs).toBeGreaterThan(0);
  });

  test('refills over time', async () => {
    const rule = uniqueRule({ limit: 2, windowSec: 1 }); // 2 tokens per second
    await limiter.check(rule, 'u1');
    await limiter.check(rule, 'u1');
    expect((await limiter.check(rule, 'u1')).allowed).toBe(false);

    await sleep(700); // ~1.4 tokens back
    expect((await limiter.check(rule, 'u1')).allowed).toBe(true);
  });

  test('identifiers are isolated from each other', async () => {
    const rule = uniqueRule({ limit: 1, windowSec: 3600 });
    expect((await limiter.check(rule, 'alice')).allowed).toBe(true);
    expect((await limiter.check(rule, 'alice')).allowed).toBe(false);
    expect((await limiter.check(rule, 'bob')).allowed).toBe(true);
  });

  test('idle keys expire so Redis does not grow forever', async () => {
    const rule = uniqueRule({ limit: 1, windowSec: 1 });
    await limiter.check(rule, 'ttl');
    const ttl = await redis.pttl(`rl:${rule.name}:ttl`);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(2000);
  });
});

describe('sliding window', () => {
  test('is exact: never more than `limit` in any window', async () => {
    const rule = uniqueRule({ algorithm: 'sliding_window', limit: 3, windowSec: 1 });
    const first = [];
    for (let i = 0; i < 5; i++) first.push(await limiter.check(rule, 'u1'));
    expect(first.filter((r) => r.allowed)).toHaveLength(3);

    await sleep(1100); // window slides past the old entries
    expect((await limiter.check(rule, 'u1')).allowed).toBe(true);
  });

  test('retryAfterMs points at when the oldest request leaves the window', async () => {
    const rule = uniqueRule({ algorithm: 'sliding_window', limit: 1, windowSec: 2 });
    await limiter.check(rule, 'u1');
    const blocked = await limiter.check(rule, 'u1');
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
    expect(blocked.retryAfterMs).toBeLessThanOrEqual(2000);
  });
});

describe('fixed window', () => {
  test('counts up to the limit then blocks until the window rolls over', async () => {
    const rule = uniqueRule({ algorithm: 'fixed_window', limit: 3, windowSec: 1 });
    const results = [];
    for (let i = 0; i < 5; i++) results.push(await limiter.check(rule, 'u1'));
    // The window can roll over mid-loop, so assert the invariant rather than an exact split
    expect(results.filter((r) => r.allowed).length).toBeGreaterThanOrEqual(3);
    expect(results.filter((r) => r.allowed).length).toBeLessThanOrEqual(5);

    await sleep(1100);
    expect((await limiter.check(rule, 'u1')).allowed).toBe(true);
  });
});

describe('atomicity under concurrency (the point of the project)', () => {
  const LIMIT = 50;
  const REQUESTS = 500;

  test.each(['token_bucket', 'sliding_window', 'fixed_window'])(
    '%s lets through exactly the limit under concurrent load',
    async (algorithm) => {
      // long window so refill/rollover cannot add noise
      const rule = uniqueRule({ algorithm, limit: LIMIT, windowSec: 3600 });
      const results = await Promise.all(
        Array.from({ length: REQUESTS }, () => limiter.check(rule, 'hot-key'))
      );
      expect(results.filter((r) => r.allowed)).toHaveLength(LIMIT);
    }
  );

  test('the naive read-then-write limiter OVERSHOOTS under the same load', async () => {
    const key = `test-naive-${randomUUID()}`;
    const results = await Promise.all(
      Array.from({ length: REQUESTS }, () => naiveCheck(redis, key, LIMIT, 60))
    );
    const allowed = results.filter((r) => r.allowed).length;
    expect(allowed).toBeGreaterThan(LIMIT); // this is the bug the Lua scripts fix
  });
});
