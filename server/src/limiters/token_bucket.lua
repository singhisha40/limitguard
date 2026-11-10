-- Token bucket, atomic.
-- KEYS[1] = bucket key
-- ARGV[1] = capacity (max burst)
-- ARGV[2] = refill rate (tokens per second)
-- ARGV[3] = cost of this request (usually 1)
-- Returns { allowed (1/0), remaining tokens, retryAfterMs }
--
-- The clock comes from Redis (TIME), not from the app server, so
-- app servers with drifting clocks cannot hand out extra tokens.

local key      = KEYS[1]
local capacity = tonumber(ARGV[1])
local refill   = tonumber(ARGV[2])
local cost     = tonumber(ARGV[3])

local t   = redis.call('TIME')
local now = t[1] * 1000 + math.floor(t[2] / 1000)

local data   = redis.call('HMGET', key, 'tokens', 'ts')
local tokens = tonumber(data[1])
local ts     = tonumber(data[2])

if tokens == nil then
  tokens = capacity
  ts = now
end

local elapsed = math.max(0, now - ts)
tokens = math.min(capacity, tokens + (elapsed / 1000) * refill)

local allowed = 0
local retry = 0
if tokens >= cost then
  tokens = tokens - cost
  allowed = 1
else
  retry = math.ceil(((cost - tokens) / refill) * 1000)
end

redis.call('HSET', key, 'tokens', tostring(tokens), 'ts', now)
-- Idle buckets are always full again after capacity/refill seconds, so they can expire.
redis.call('PEXPIRE', key, math.ceil((capacity / refill) * 1000) * 2)

return { allowed, math.floor(tokens), retry }
