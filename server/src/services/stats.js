const BUCKET_MS = 10_000; // 10 second buckets
const KEEP_SECONDS = 60 * 60; // keep one hour of history

/**
 * Per-request counters are written to Redis with HINCRBY (O(1), no Mongo write on the hot path).
 * Layout: stats:<bucketId>  ->  hash of "<rule>:allowed" / "<rule>:blocked" -> count
 */
function createStats(redis) {
  const bucketId = (ms = Date.now()) => Math.floor(ms / BUCKET_MS);

  async function record(ruleName, allowed) {
    const key = `stats:${bucketId()}`;
    try {
      await redis
        .multi()
        .hincrby(key, `${ruleName}:${allowed ? 'allowed' : 'blocked'}`, 1)
        .expire(key, KEEP_SECONDS)
        .exec();
    } catch {
      /* stats must never break the request path */
    }
  }

  async function series(buckets = 30) {
    const end = bucketId();
    const ids = Array.from({ length: buckets }, (_, i) => end - (buckets - 1 - i));
    const pipeline = redis.pipeline();
    ids.forEach((id) => pipeline.hgetall(`stats:${id}`));
    const results = await pipeline.exec();

    return ids.map((id, i) => {
      const hash = results[i][1] || {};
      let allowed = 0;
      let blocked = 0;
      const byRule = {};
      for (const [field, value] of Object.entries(hash)) {
        const [rule, kind] = field.split(':');
        const n = Number(value);
        byRule[rule] = byRule[rule] || { allowed: 0, blocked: 0 };
        byRule[rule][kind] += n;
        if (kind === 'allowed') allowed += n;
        else blocked += n;
      }
      return { t: id * BUCKET_MS, allowed, blocked, byRule };
    });
  }

  return { record, series, BUCKET_MS };
}

module.exports = { createStats };
