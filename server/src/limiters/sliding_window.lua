-- Sliding window log, atomic (sorted set of request timestamps).
-- KEYS[1] = window key
-- ARGV[1] = limit
-- ARGV[2] = window size in ms
-- ARGV[3] = unique member id for this request
-- Returns { allowed (1/0), remaining, retryAfterMs }
--
-- Exact, but memory is O(limit) per key. See README for the tradeoff vs fixed window.

local key    = KEYS[1]
local limit  = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local member = ARGV[3]

local t   = redis.call('TIME')
local now = t[1] * 1000 + math.floor(t[2] / 1000)

redis.call('ZREMRANGEBYSCORE', key, 0, now - window)
local count = redis.call('ZCARD', key)

if count < limit then
  redis.call('ZADD', key, now, member)
  redis.call('PEXPIRE', key, window)
  return { 1, limit - count - 1, 0 }
end

local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
local retry = window
if oldest[2] then
  retry = math.max(1, tonumber(oldest[2]) + window - now)
end
return { 0, 0, retry }
