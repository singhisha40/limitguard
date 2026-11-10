/**
 * The BROKEN limiter. It exists only to demonstrate the race condition.
 *
 * It reads the counter, decides in JavaScript, then writes. Between the GET and
 * the INCR another request can do the same thing, so under concurrency many
 * requests all see "count < limit" and all get through.
 *
 * Never use this in a real service. See token_bucket.lua for the atomic version.
 */
async function naiveCheck(redis, key, limit, windowSec) {
  const current = Number(await redis.get(key)) || 0; // (1) read
  if (current >= limit) {
    return { allowed: false, remaining: 0 };
  }
  // <-- other requests can slip in here
  const next = await redis.incr(key); // (2) write
  if (next === 1) await redis.expire(key, windowSec);
  return { allowed: true, remaining: Math.max(0, limit - next) };
}

module.exports = { naiveCheck };
