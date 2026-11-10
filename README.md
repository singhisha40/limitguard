# LimitGuard

A distributed rate limiter service. Any number of API servers share one Redis, and every limit decision is made **atomically inside Redis** with Lua scripts, so concurrent requests can never sneak past a limit.

**Stack:** Node.js + Express, Redis (ioredis + Lua), MongoDB (Mongoose), React (Vite), Docker Compose.

## What it does

- Three algorithms, each as an atomic Lua script: **token bucket**, **sliding window log**, **fixed window counter**
- Express middleware: `app.get('/x', rateLimit('default'), handler)` with standard `RateLimit-*` and `Retry-After` headers and `429` responses
- Standalone HTTP API: `POST /v1/check` so any service in any language can ask "may this user proceed?"
- Rules (algorithm, limit, window, key type, enabled) stored in MongoDB, cached in memory, editable from the dashboard
- Per-request counters in Redis, rendered as a live chart; sampled block events in MongoDB with a 24h TTL index
- Configurable **fail-open / fail-closed** behaviour when Redis is down
- **Race condition demo:** the same concurrent burst hits a naive limiter and the atomic one, and you see how many requests each let through

## Architecture

```
                     +--------------------+
  React dashboard -->|   Express server   |<-- other services: POST /v1/check
  (Vite / nginx)     |  rateLimit('rule') |
                     +----+---------+-----+
                          |         |
              rules (cached 5s)     | EVALSHA <lua script>   (one round trip, atomic)
                          |         |
                     +----v---+  +--v------------------+
                     | MongoDB|  | Redis               |
                     | rules  |  | rl:<rule>:<id>  state|
                     | blocks |  | stats:<bucket> counts|
                     +--------+  +---------------------+
```

Hot path for one request: look up rule in memory (no DB), one Redis `EVALSHA`, one Redis `MULTI` for stats (not awaited), respond. MongoDB is never touched per request except for sampled block events, and those are fire-and-forget.

## Run it

### Option A: Docker (everything)

```bash
docker compose up --build
# dashboard: http://localhost:8080     API: http://localhost:4000
```

### Option B: local

You need Node 20+ and a Redis. MongoDB is optional (without it the server uses built-in rules and rule editing is disabled).

```bash
# terminal 1
cd server && cp .env.example .env && npm install && npm start
# terminal 2
cd client && npm install && npm run dev      # http://localhost:5173
```

### Tests and load test

```bash
cd server
npm test              # needs Redis on localhost:6379
npm run loadtest      # needs the server running; prints your numbers
```

## API

| Method | Path | Purpose |
|---|---|---|
| POST | `/v1/check` | `{ rule, identifier }` returns `{ allowed, remaining, retryAfterMs, limit }` |
| GET | `/api/protected/ping` | demo endpoint, rule `default` (token bucket) |
| GET | `/api/protected/search` | demo endpoint, rule `strict` (sliding window) |
| POST | `/api/protected/login` | demo endpoint, rule `login` (fixed window) |
| GET/POST/PUT/DELETE | `/api/rules` | manage rules (write operations need MongoDB) |
| GET | `/api/stats?buckets=30` | allowed/blocked counts per 10s bucket |
| GET | `/api/events` | recent blocked requests |
| POST | `/api/demo/race` | naive vs atomic concurrency experiment |
| GET | `/health` | Redis and Mongo status |

Example:

```bash
curl -X POST localhost:4000/v1/check -H 'content-type: application/json' \
  -d '{"rule":"strict","identifier":"user-42"}'
```

## The core idea: why Lua

A naive limiter does this:

```js
const count = await redis.get(key);      // 1. read
if (count < limit) await redis.incr(key); // 2. write
```

With 1000 concurrent requests, all 1000 reads happen before any write, so all 1000 see `count = 0` and all are allowed. See `server/src/limiters/naive.js`; the race demo and a Jest test prove it.

Redis runs one command (or one Lua script) at a time, so putting the read, the decision and the write in a single script makes the whole check atomic. See `server/src/limiters/*.lua`. A test fires 500 concurrent requests at a limit of 50 and asserts exactly 50 are allowed, for each algorithm.

## Algorithm comparison

| | Token bucket | Sliding window log | Fixed window |
|---|---|---|---|
| Memory per key | 1 hash (2 fields) | 1 sorted set, up to `limit` entries | 1 integer |
| Accuracy | Allows bursts up to capacity, then steady rate | Exact: never more than `limit` in any window | Up to **2x limit** across a window boundary |
| Best for | General APIs where bursts are fine | Strict limits, low limits | Cheap, coarse limits (login attempts) |
| Cost | Cheap | Highest | Cheapest |

## Design decisions and tradeoffs

- **Redis time, not app server time.** Scripts call `redis.call('TIME')`, so app servers with clock drift cannot hand out extra tokens.
- **Rules cached in memory (5s TTL).** Keeps MongoDB off the hot path. The cost: a rule edit takes up to 5s to reach other server instances (the instance that handled the edit refreshes immediately). Acceptable for config that changes rarely.

## Limitations and what I would change at scale

- **Single Redis = single point of failure and a throughput ceiling.** Next steps: Redis Sentinel for failover; Redis Cluster for sharding. Each limiter touches one key, so it shards cleanly by key.

## Project layout

```
server/
  src/limiters/        token_bucket.lua, sliding_window.lua, fixed_window.lua, index.js, naive.js
  src/middleware/      rateLimit.js
  src/services/        ruleStore.js (cached rules), stats.js (Redis counters)
  src/models/          Rule.js, BlockEvent.js
  src/routes/          rules.js, demo.js
  src/app.js           routes and wiring (dependency-injected for tests)
  tests/               limiters, api, ruleStore
  loadtest/            naive-vs-atomic.js
client/src/components/ Dashboard, StatsChart, Playground, RaceDemo, RulesPanel
docker-compose.yml     redis, mongo, server, client
```