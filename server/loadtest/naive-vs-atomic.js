/**
 * Load test for a RUNNING server (npm start in another terminal).
 *
 *   BASE_URL=http://localhost:4000 npm run loadtest
 *
 * 1. Race demo: naive vs atomic limiter, concurrent checks, count how many got through.
 * 2. Throughput + latency overhead: /api/open/ping (no limiter) vs /api/protected/ping (limiter on).
 *    Put the numbers you measure on YOUR machine in your README and resume.
 */
const autocannon = require('autocannon');

const BASE = process.env.BASE_URL || 'http://localhost:4000';
const DURATION = Number(process.env.DURATION || 10);
const CONNECTIONS = Number(process.env.CONNECTIONS || 100);

async function race() {
  const res = await fetch(`${BASE}/api/demo/race`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ limit: 100, requests: 1000 }),
  });
  const r = await res.json();
  console.log('\n=== Race condition demo (limit 100, 1000 concurrent requests) ===');
  console.table({
    'naive (GET then INCR)': { allowed: r.naive.allowed, overshoot: r.naive.overshoot, ms: r.naive.ms },
    'atomic (Lua script)': { allowed: r.atomic.allowed, overshoot: r.atomic.overshoot, ms: r.atomic.ms },
  });
}

function run(title, path) {
  return new Promise((resolve, reject) => {
    autocannon({ url: `${BASE}${path}`, connections: CONNECTIONS, duration: DURATION }, (err, r) => {
      if (err) return reject(err);
      const s = r.statusCodeStats;
      const ok = s['200'] ? s['200'].count : 0;
      const limited = s['429'] ? s['429'].count : 0;
      resolve({
        endpoint: title,
        'req/s': Math.round(r.requests.average),
        'p50 ms': r.latency.p50,
        'p97.5 ms': r.latency.p97_5,
        'p99 ms': r.latency.p99,
        '200': ok,
        '429': limited,
      });
    });
  });
}

(async () => {
  await race();
  console.log(`\n=== Throughput and latency (${CONNECTIONS} connections, ${DURATION}s each) ===`);
  const rows = [];
  rows.push(await run('/api/open/ping (no limiter, no Redis)', '/api/open/ping'));
  rows.push(await run('/api/protected/ping (token bucket)', '/api/protected/ping'));
  console.table(rows);
  console.log('Latency overhead of the limiter = difference between the two rows.');
})().catch((e) => {
  console.error('Load test failed. Is the server running at', BASE, '?', e.message);
  process.exit(1);
});
